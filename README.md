## Prerequisites
- [Node.js](https://nodejs.org/) (v14+)
- OpenAI API Key ([get it here](https://platform.openai.com/))

## To run the program on your local machine
1. Clone the repository:
   ```bash
   git clone https://github.com/leslie0605/mock-interview-platform.git
   cd mock-interview-platform
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create an .env file and add your OpenAI API key:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   ```
4. Start the backend:
   ```bash
   node server.js 
   ```
5. Run the frontend:
      ```bash
   git clone https://github.com/leslie0605/mock-interview-platform-frontend.git
   cd mock-interview-platform-frontend
   npm install
   npm start
   ```
## How to use the mock interview platform?

1. Provide your resume and role details: Start by uploading your resume in PDF format through the provided form on the homepage. Fill in the company name, role name, job description.
2. Begin the Interview: Once you click the "Submit" button, you will be directed to the interview screen. Click the "Start Answering" button to begin the mock interview.
