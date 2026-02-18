import { GoogleGenAI, Type } from "@google/genai";
import { EvaluationReport, FileData } from "../types.ts";

export type EvaluationMode = 'with-manual' | 'without-manual';

export const generateStructuredFeedback = async (
  sourceDoc: FileData,
  dirtyFeedbackDoc: FileData | null,
  mode: EvaluationMode = 'with-manual'
): Promise<EvaluationReport> => {
  // Use a fallback to prevent "Cannot read property 'API_KEY' of undefined"
  const apiKey = (window as any).process?.env?.API_KEY || '';
  const ai = new GoogleGenAI({ apiKey });
  
  const baseInstruction = `
    You are the "Anatomy Guru Master Evaluator", a professional medical academic auditor. 
    Your task is to generate a high-quality, clinical-grade evaluation report for medical students.
  `;

  const manualFeedbackContext = mode === 'with-manual' 
    ? `
      FACULTY NOTES (Manual Feedback) provided. Priority: Answer Key for facts, Faculty for marks.
    `
    : `
      AUTOMATED AUDIT. Evaluate EVERY question against the Answer Key.
    `;

  const systemInstruction = `
    ${baseInstruction}
    ${manualFeedbackContext}
    OUTPUT: Valid JSON only.
  `;

  const createPart = (data: FileData | null, label: string) => {
    if (!data) return [{ text: `${label}: Not provided.` }];
    if (data.isDocx && data.text) {
      return [{ text: `${label}: (Text)\n${data.text}` }];
    } else if (data.base64 && data.mimeType) {
      return [
        { text: `${label}: (File)` },
        { inlineData: { data: data.base64, mimeType: data.mimeType } }
      ];
    }
    return [{ text: `${label}: No data.` }];
  };

  const contentsParts = [
    ...createPart(sourceDoc, "Source Document"),
    ...(mode === 'with-manual' && dirtyFeedbackDoc ? createPart(dirtyFeedbackDoc, "Faculty Notes") : []),
    { text: "Generate the comprehensive medical evaluation report in JSON format." }
  ];

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts: contentsParts }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          studentName: { type: Type.STRING },
          testTitle: { type: Type.STRING },
          testTopics: { type: Type.STRING },
          testDate: { type: Type.STRING },
          totalScore: { type: Type.NUMBER },
          maxScore: { type: Type.NUMBER },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                qNo: { type: Type.STRING },
                feedbackPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                marks: { type: Type.NUMBER },
                maxMarks: { type: Type.NUMBER },
                isCorrect: { type: Type.BOOLEAN },
                isFlagged: { type: Type.BOOLEAN }
              },
              required: ["qNo", "feedbackPoints", "marks", "maxMarks", "isCorrect"]
            }
          },
          generalFeedback: {
            type: Type.OBJECT,
            properties: {
              overallPerformance: { type: Type.ARRAY, items: { type: Type.STRING } },
              mcqs: { type: Type.ARRAY, items: { type: Type.STRING } },
              contentAccuracy: { type: Type.ARRAY, items: { type: Type.STRING } },
              completenessOfAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
              presentationDiagrams: { type: Type.ARRAY, items: { type: Type.STRING } },
              investigations: { type: Type.ARRAY, items: { type: Type.STRING } },
              attemptingQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              actionPoints: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["overallPerformance", "mcqs", "contentAccuracy", "completenessOfAnswers", "presentationDiagrams", "investigations", "attemptingQuestions", "actionPoints"]
          }
        },
        required: ["studentName", "testTitle", "testTopics", "testDate", "totalScore", "maxScore", "questions", "generalFeedback"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}') as EvaluationReport;
  } catch (error) {
    throw new Error("AI response was not valid JSON. Please try again.");
  }
};