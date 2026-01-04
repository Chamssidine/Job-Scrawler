import OpenAI from "openai";


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


export async function exploreDepth(url) {

    const response = await openai.responses.create({
  model: "gpt-5.2",
  input: `Explore the following URL and search for job offers and return all relevant data such as job description, correspondant name, email, and telephone number ${url}`,
});
console.log(`Depth  exploration response:`, response.output_text);
}