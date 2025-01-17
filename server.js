const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const pdf = require("pdf-parse");
const FormData = require("form-data");
require("dotenv").config();

const FileType = require("file-type");

// Set up express server
const app = express();
const PORT = 8081;

// Add middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // 设置文件存储目录
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // 使用文件的原始名称
  },
});

const upload = multer({ storage: storage });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store session data
let singleSession = {
  companyName: "",
  roleName: "",
  jobDescription: "",
  interviewDuration: "",
  resumeText: "",
  chatHistory: [],
};

// Upload resume and details of the role
app.post("/api/upload-details", upload.single("resume"), async (req, res) => {
  try {
    // 从 body 中读取参数
    const { companyName, roleName, jobDescription, interviewDuration } =
      req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Resume file is required." });
    }

    // 读取上传的 PDF 文件并解析
    const resumeFilePath = path.join(__dirname, req.file.path);
    const pdfBuffer = fs.readFileSync(resumeFilePath);
    const pdfData = await pdf(pdfBuffer);
    const resumeText = pdfData.text;

    // 删掉临时文件
    fs.unlinkSync(resumeFilePath);

    // 存到内存中
    singleSession = {
      companyName,
      roleName,
      jobDescription,
      interviewDuration,
      resumeText,
      chatHistory: [],
    };

    console.log(`   Company: ${companyName}`);
    console.log(`   Role:    ${roleName}`);
    console.log(`   JD:      ${jobDescription}`);
    console.log(`   Duration:${interviewDuration}`);
    console.log(`   Resume:  ${resumeText.substring(0, 200)}...`); // 仅打印前200字符

    res.json({ message: "Setup completed!" });
  } catch (err) {
    console.error("Error in /api/setup:", err);
    res.status(500).json({ error: "Error setting up interview session." });
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    console.log("==> [DEBUG] Inside /api/transcribe");
    console.log("req.file:", req.file);

    // Whisper 转写
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required." });
    }
    const audioFilePath = path.join(__dirname, req.file.path);

    console.log("==> [DEBUG] Audio file path:", audioFilePath);
    // 使用 file-type 检测实际文件类型
    const buffer = fs.readFileSync(audioFilePath);
    const typeInfo = await FileType.fromBuffer(buffer);
    // 如果 typeInfo 为空，说明无法识别文件格式
    console.log("==> [DEBUG] fileType info:", typeInfo);

    // 准备 FormData 发给 OpenAI Whisper
    const formData = new FormData();
    formData.append("file", fs.createReadStream(audioFilePath));
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");

    console.log("==> [DEBUG] FormData:", formData);

    const transcriptionResponse = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    console.log(
      "==> [DEBUG] Transcription response:",
      transcriptionResponse.data
    );

    // 删掉临时音频文件
    fs.unlinkSync(audioFilePath);

    // 得到用户说的话
    const userTranscript = transcriptionResponse.data;
    console.log(`==> [TRANSCRIBE] User said: ${userTranscript}`);

    // ChatGPT 对话
    // 取出已有信息
    const { companyName, roleName, jobDescription, resumeText, chatHistory } =
      singleSession;

    // 系统提示
    const systemPrompt = `You are an interviewer from the company ${companyName}.
Today there is a candidate interviewing for the position ${roleName}.
Here is the job description: ${jobDescription}.
The candidate's resume is as follows: ${resumeText}.
Please ask relevant interview questions based on the resume and the candidate's responses.
Ask questions one by one like a real interview. 
Please start with a general question like "Tell me about yourself".`;

    // 组装消息
    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory, // 把历史消息加进去
      { role: "user", content: userTranscript },
    ];

    // 调用 ChatGPT
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
    });

    const chatContent = chatResponse.choices[0].message.content;

    // 把这次对话（User/Assistant）存到 chatHistory
    singleSession.chatHistory.push(
      { role: "user", content: userTranscript },
      { role: "assistant", content: chatContent }
    );

    console.log(`   ChatGPT answered: ${chatContent}`);

    // 返回给前端
    res.json({
      transcript: userTranscript,
      nextQuestion: chatContent,
    });
  } catch (err) {
    console.error("Error in /api/transcribe:", err.message);
    if (err.response) {
      console.error(
        `HTTP Error: ${err.response.status} - ${err.response.statusText}`
      );
      console.error("Error details:", err.response.data);
    }
    res
      .status(500)
      .json({ error: "Error transcribing audio or calling ChatGPT." });
  }
});

// Audio generation endpoint
app.post("/api/speech", async (req, res) => {
  const { text, model = "tts-1", voice = "echo" } = req.body;

  // Validate input
  if (!text) {
    return res
      .status(400)
      .json({ error: "Text is required for speech generation." });
  }

  const url = "https://api.openai.com/v1/audio/speech";
  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // 从 .env 文件加载 API 密钥
  };

  const data = {
    model,
    input: text,
    voice,
    response_format: "mp3",
  };

  try {
    const response = await axios.post(url, data, {
      headers,
      responseType: "stream",
    });

    const outputFilePath = path.join(__dirname, "output.mp3");
    const writeStream = fs.createWriteStream(outputFilePath);

    // 保存音频到文件
    response.data.pipe(writeStream);

    writeStream.on("finish", () => {
      res.download(outputFilePath, "speech.mp3", (err) => {
        if (err) {
          console.error("Error sending file:", err);
          res.status(500).send("Error sending file.");
        }
        // 删除临时文件
        fs.unlinkSync(outputFilePath);
      });
    });

    writeStream.on("error", (err) => {
      console.error("Error writing file:", err);
      res.status(500).send("Error generating audio.");
    });
  } catch (error) {
    console.error("Error generating speech:", error.message);
    if (error.response) {
      console.error(
        `Error with HTTP request: ${error.response.status} - ${error.response.statusText}`
      );
    }
    res.status(500).json({ error: "Error generating speech." });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
