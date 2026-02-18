
import { GoogleGenAI, Type } from "@google/genai";
import { EvaluationReport, FileData } from "../types";

export type EvaluationMode = 'with-manual' | 'without-manual';

export const generateStructuredFeedback = async (
  sourceDoc: FileData,
  dirtyFeedbackDoc: FileData | null,
  mode: EvaluationMode = 'with-manual'
): Promise<EvaluationReport> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const baseInstruction = `
    You are the "Anatomy Guru Master Evaluator", a professional medical academic auditor. 
    Your task is to generate a high-quality, clinical-grade evaluation report for medical students.
    
    THE SOURCE DOCUMENT (Student Answer Sheet) contains:
    1. The Question Paper (QP) with marking schemes.
    2. The Official Answer Key (The Absolute Truth).
    3. The Student's actual answers.
  `;

  const manualFeedbackContext = mode === 'with-manual' 
    ? `
      FACULTY NOTES (Manual Feedback): This document contains manual marks and shorthand notes.
      
      STRICT HIERARCHY OF TRUTH:
      1. OFFICIAL ANSWER KEY: Absolute truth for medical facts and MCQ options.
      2. FACULTY NOTES: Final authority for MARKS assigned, but secondary to Key for factual correctness.
      
      CONTRADICTION PROTOCOL:
      - If Faculty Notes contradict the Answer Key regarding medical facts, anatomical descriptions, or clinical findings:
        1. You MUST strictly use the Answer Key content for your feedback points.
        2. You MUST set "isFlagged": true for that specific question.
        3. Professionaly highlight the correction (e.g., "The Answer Key requires mention of the femoral nerve, though manual notes omitted this detail").
      - Retain the marks from Faculty Notes even if you flag a contradiction.
    `
    : `
      EVALUATION MODE: AUTOMATED AUDIT (No Faculty Notes provided).
      
      STRICT COMPREHENSIVE PROTOCOL:
      1. EXHAUSTIVE AUDIT: You MUST evaluate EVERY single question listed in the Question Paper/Answer Key. 
      2. NO OMISSIONS: Do NOT skip questions that the student answered correctly. The "questions" array must be a complete 1:1 map of the entire test.
      3. POSITIVE FEEDBACK: For correct answers, provide feedback acknowledging their accuracy based on the Official Answer Key.
      4. ERROR IDENTIFICATION: For incorrect answers, precisely identify the gap using the Key.
      5. FAIR GRADING: Use ONLY the Official Answer Key found in the Source Document to assign marks.
    `;

  const evaluationLogic = `
      1. MCQ RIGOR:
      - Locate the "Official Answer Key" in the Source Document.
      - Cross-check student choices 1:1 against the Key for ALL questions.

      2. DESCRIPTIVE EVALUATION:
      - Compare the student's response against the Answer Key content.
      - In "without-manual" mode, ensure you generate an entry for every question, providing detailed feedback points regardless of whether the answer was right or wrong.
      - If faculty notes are provided (Mode: with-manual), check for discrepancies. 
      - If discrepancy exists between Key and Faculty, set isFlagged to true and follow the Key.

      3. GENERAL FEEDBACK (8-POINT STRUCTURE):
      - Must cover: Overall Performance, MCQs, Content Accuracy, Completeness, Presentation/Diagrams, Investigations, Attempt Strategy, and Action Points.
  `;

  const systemInstruction = `
    ${baseInstruction}
    ${manualFeedbackContext}
    ${evaluationLogic}
    OUTPUT: Valid JSON only. Feedback points must be arrays of strings. "isFlagged" should be true ONLY when a factual contradiction between Faculty Notes and the Answer Key was resolved in favor of the Key. 
    IMPORTANT: The "questions" array MUST be exhaustive. Include every question from the source document.
  `;

  const createPart = (data: FileData | null, label: string) => {
    if (!data) return [{ text: `${label}: Not provided.` }];
    if (data.isDocx && data.text) {
      return [{ text: `${label}: (Extracted from Word Document)\n${data.text}` }];
    } else if (data.base64 && data.mimeType) {
      return [
        { text: `${label}: (Binary File)` },
        { inlineData: { data: data.base64, mimeType: data.mimeType } }
      ];
    }
    return [{ text: `${label}: No data available.` }];
  };

  const contentsParts = [
    ...createPart(sourceDoc, "Source Document (QP + Key + Student Answers)")
  ];

  if (mode === 'with-manual' && dirtyFeedbackDoc) {
    contentsParts.push(...createPart(dirtyFeedbackDoc, "Faculty Notes (Manual Feedback)"));
  }

  const promptText = mode === 'with-manual'
    ? "Generate the evaluation report. STRICTLY prioritize the Answer Key over Faculty Notes for facts. Flag any questions where faculty notes contradicted the official answer key. Ensure every question is listed."
    : "Generate a COMPREHENSIVE evaluation report. Evaluate EVERY single question in the test. Do not skip correct answers; provide feedback for every item against the Official Answer Key.";

  contentsParts.push({ text: promptText });

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
            required: [
              "overallPerformance", "mcqs", "contentAccuracy", "completenessOfAnswers", 
              "presentationDiagrams", "investigations", "attemptingQuestions", "actionPoints"
            ]
          }
        },
        required: ["studentName", "testTitle", "testTopics", "testDate", "totalScore", "maxScore", "questions", "generalFeedback"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text);
    return data as EvaluationReport;
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    throw new Error("Could not generate structured feedback. Please try again with clearer documents.");
  }
};
