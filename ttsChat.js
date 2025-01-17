// Import required modules
const Microphone = require("node-microphone");
const pdf = require("pdf-parse");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const readline = require("readline");
const axios = require("axios");
const FormData = require("form-data");
const Speaker = require("speaker");
const OpenAI = require("openai");
require("dotenv").config();

// Set the path for FFmpeg, used for audio processing
ffmpeg.setFfmpegPath(ffmpegPath);

// Initialize OpenAI API client with the provided API key
const secretKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: secretKey,
});

// Variables to store chat history and other components
let chatHistory = []; // To store the conversation history
let mic, micStream, rl; // Microphone, microphone stream, and readline interface
let outputFilePath, outputFile; // Path to the output file, and the output file stream

// Example data for the interview scenario
const companyName = "Google"; // Example company name
const roleName = "Software Engineer"; // Example role name
const jobDescription = `• Design, develop, and deliver technical solutions rapidly, end to end, and across the full stack.
• Work collaboratively with other engineers, QA, Product Managers, UX, and other cross-functional teams as needed.
• Uphold and maintain a high bar for code quality and robustness of production systems.`; // Example job description
const resumePath = "resume.pdf"; // Path to the candidate's resume

console.log(
  `\n# # # # # # # # # # # # # # # # # # # # #\n# Welcome to your AI-powered interview partner! #\n# # # # # # # # # # # # # # # # # # # # #\n`
);

// Function to set up the readline interface for user input
const setupReadlineInterface = () => {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  readline.emitKeypressEvents(process.stdin, rl);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Handle keypress events
  process.stdin.on("keypress", (str, key) => {
    if (
      key &&
      (key.name.toLowerCase() === "return" ||
        key.name.toLowerCase() === "enter")
    ) {
      if (micStream) {
        stopRecordingAndProcess();
      } else {
        startRecording();
      }
    } else if (key && key.ctrl && key.name === "c") {
      process.exit(); // Handle ctrl+c for exiting
    } else if (key) {
      console.log("Exiting application...");
      process.exit(0);
    }
  });

  console.log("Press Enter when you're ready to start speaking.");
};

// Function to start recording audio from the microphone
const startRecording = () => {
  mic = new Microphone();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-"); // Timestamp for the output file
  outputFilePath = `output-${timestamp}.wav`;
  outputFile = fs.createWriteStream(outputFilePath);

  micStream = mic.startRecording();

  // Write incoming data to the output file
  micStream.on("data", (data) => {
    outputFile.write(data);
  });

  // Handle microphone errors
  micStream.on("error", (error) => {
    console.error("Error: ", error);
  });

  console.log("Recording... Press Enter to stop");
};

// Function to stop recording and process the audio
const stopRecordingAndProcess = () => {
  mic.stopRecording();
  outputFile.end();
  console.log(`Recording stopped, processing audio...`);
  transcribeAndChat(outputFilePath); // Transcribe the audio and initiate chat
};

// Default voice setting for text-to-speech
const inputVoice = "echo"; // https://platform.openai.com/docs/guides/text-to-speech/voice-options
const inputModel = "tts-1"; // https://platform.openai.com/docs/guides/text-to-speech/audio-quality

// Function to convert text to speech and play it using Speaker
async function streamedAudio(
  inputText,
  model = inputModel,
  voice = inputVoice
) {
  const url = "https://api.openai.com/v1/audio/speech";
  const headers = {
    Authorization: `Bearer ${secretKey}`, // API key for authentication
  };

  const data = {
    model: model,
    input: inputText,
    voice: voice,
    response_format: "mp3",
  };

  try {
    // Make a POST request to the OpenAI audio API
    const response = await axios.post(url, data, {
      headers: headers,
      responseType: "stream",
    });

    // Configure speaker settings
    const speaker = new Speaker({
      channels: 2, // Stereo audio
      bitDepth: 16,
      sampleRate: 44100,
    });

    // Convert the response to the desired audio format and play it
    ffmpeg(response.data)
      .toFormat("s16le")
      .audioChannels(2)
      .audioFrequency(44100)
      .pipe(speaker);
  } catch (error) {
    // Handle errors from the API or the audio processing
    if (error.response) {
      console.error(
        `Error with HTTP request: ${error.response.status} - ${error.response.statusText}`
      );
    } else {
      console.error(`Error in streamedAudio: ${error.message}`);
    }
  }
}

// Function to extract text from a PDF file
async function extractTextFromPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  try {
    const data = await pdf(dataBuffer);
    return data.text; // Extracted text from PDF
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    return "";
  }
}

// Function to evaluate the user's response
async function evaluateResponse(userResponse, question) {
  const evaluationPrompt = `
As an expert interviewer, evaluate the candidate's response to the following question.

Question: "${question}"
Candidate's Response: "${userResponse}"

Provide a score from 0 to 10, where 10 is excellent and 0 is poor. Then, give detailed feedback on the coherence and relevance of the response.

Format:
Score: [score]
Feedback: [feedback]
`;

  try {
    const evaluationResponse = await openai.chat.completions.create({
      messages: [{ role: "user", content: evaluationPrompt }],
      model: "gpt-3.5-turbo",
    });

    const evaluationText = evaluationResponse.choices[0].message.content;
    console.log(`\n### Evaluation ###\n${evaluationText}\n#################\n`);
  } catch (error) {
    if (error.response) {
      console.error(
        `Error during evaluation: ${error.response.status} - ${error.response.statusText}`
      );
    } else {
      console.error("Error during evaluation:", error.message);
    }
  }
}

// Function to transcribe audio to text and send it to the chatbot
async function transcribeAndChat(filePath) {
  // Note that the file size limitations are 25MB for Whisper

  // Prepare form data for the transcription request
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  try {
    // Post the audio file to OpenAI for transcription
    const resumeText = await extractTextFromPDF(resumePath);
    const transcriptionResponse = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    // Extract transcribed text from the response
    const transcribedText = transcriptionResponse.data;
    console.log(`>> You said: ${transcribedText}`);

    // Get the last assistant message (the question)
    const lastAssistantMessage = chatHistory
      .slice()
      .reverse()
      .find((msg) => msg.role === "assistant")?.content;

    // Evaluate the user's response
    if (lastAssistantMessage) {
      await evaluateResponse(transcribedText, lastAssistantMessage);
    }

    // Prepare messages for the chatbot, including the transcribed text
    const messages = [
      {
        role: "system",
        content: `You are an interviewer from the company ${companyName}.
Today there is a candidate interviewing for the position ${roleName}.
Here is the job description: ${jobDescription}.
The candidate's resume is as follows: ${resumeText}.
Please ask relevant interview questions based on the resume and the candidate's responses.
Ask questions one by one like a real interview. 
Please start with a general question like "Tell me about yourself".`,
      },
      ...chatHistory,
      { role: "user", content: transcribedText },
    ];

    // Send messages to the chatbot and get the response
    const chatResponse = await openai.chat.completions.create({
      messages: messages,
      model: "gpt-3.5-turbo",
    });

    // Extract the chat response.
    const chatResponseText = chatResponse.choices[0].message.content;

    // Update chat history with the latest interaction
    chatHistory.push(
      { role: "user", content: transcribedText },
      { role: "assistant", content: chatResponseText }
    );

    // Convert the chat response to speech and play + log it to the terminal
    await streamedAudio(chatResponseText);
    console.log(`>> Interviewer said: ${chatResponseText}`);

    // Reset microphone stream and prompt for new recording
    micStream = null;
    console.log("Press Enter to speak again, or any other key to quit.\n");
  } catch (error) {
    // Handle errors from the transcription or chatbot API
    if (error.response) {
      console.error(
        `Error: ${error.response.status} - ${error.response.statusText}`
      );
    } else {
      console.error("Error:", error.message);
    }
  }
}

// Initialize the readline interface
setupReadlineInterface();
