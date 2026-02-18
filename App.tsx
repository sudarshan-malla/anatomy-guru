import React, { useState, useEffect } from 'react';
import { generateStructuredFeedback, EvaluationMode } from './services/geminiService.ts';
import { EvaluationReport, FileData } from './types.ts';
import FileUploader from './components/FileUploader.tsx';
import FeedbackReport from './components/FeedbackReport.tsx';

// Standardized imports using the names from importmap
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const initPdfWorker = () => {
  try {
    const pdfjs: any = (pdfjsLib as any).GlobalWorkerOptions 
      ? pdfjsLib 
      : (pdfjsLib as any).default || pdfjsLib;

    if (pdfjs && pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
      return pdfjs;
    }
  } catch (e) {
    console.warn("PDF worker initialization failed", e);
  }
  return null;
};

const App: React.FC = () => {
  const [sourceDoc, setSourceDoc] = useState<File | null>(null);
  const [dirtyFeedbackDoc, setDirtyFeedbackDoc] = useState<File | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'dashboard' | 'report'>('dashboard');
  const [evalMode, setEvalMode] = useState<EvaluationMode>('with-manual');
  const [pdfjsInstance, setPdfjsInstance] = useState<any>(null);

  useEffect(() => {
    setPdfjsInstance(initPdfWorker());
  }, []);

  useEffect(() => {
    if (report) setView('report');
  }, [report]);

  const extractTextFromPDF = async (file: File): Promise<string> => {
    if (!pdfjsInstance || !pdfjsInstance.getDocument) {
      throw new Error("PDF engine is initializing. Please wait a moment.");
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsInstance.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += `[Page ${i}] ${pageText}\n`;
    }
    return fullText;
  };

  const processFile = async (file: File): Promise<FileData> => {
    const fileName = file.name.toLowerCase();
    const isDocx = fileName.endsWith('.docx');
    const isPdf = fileName.endsWith('.pdf');
    
    if (isDocx) {
      setLoadingStep(`Parsing Word document...`);
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return { text: result.value, name: file.name, isDocx: true };
    } 
    
    if (isPdf) {
      setLoadingStep(`Analyzing PDF structure...`);
      try {
        const text = await extractTextFromPDF(file);
        if (text.trim().length > 50) return { text, name: file.name, isDocx: false };
      } catch (e) { 
        console.warn("PDF text extraction fallback", e); 
      }
    }

    setLoadingStep(`Preparing visual analysis...`);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
    });

    return { base64, mimeType: file.type, name: file.name, isDocx: false };
  };

  const handleAnalyze = async () => {
    if (!sourceDoc) { setError("Please upload the student answer sheet."); return; }
    
    setIsLoading(true);
    setError(null);
    try {
      const sourceData = await processFile(sourceDoc);
      const feedbackData = evalMode === 'with-manual' && dirtyFeedbackDoc ? await processFile(dirtyFeedbackDoc) : null;
      setLoadingStep("AI Medical Audit in progress...");
      const result = await generateStructuredFeedback(sourceData, feedbackData, evalMode);
      setReport(result);
    } catch (err: any) {
      console.error("Analysis failure:", err);
      setError(err.message || "An unexpected error occurred. Please check your API configuration.");
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const renderDashboard = () => (
    <div className="max-w-4xl mx-auto py-12 px-4 animate-fade-in">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-black text-slate-900 mb-2">AnatomyGuru <span className="text-red-600">Audit</span></h1>
        <p className="text-slate-500 font-medium italic">Clinical Grade Medical Feedback Engine</p>
      </div>

      <div className="flex justify-center mb-8">
        <div className="bg-slate-200 p-1 rounded-xl flex gap-1">
          <button 
            onClick={() => setEvalMode('with-manual')} 
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${evalMode === 'with-manual' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
          >
            With Faculty Notes
          </button>
          <button 
            onClick={() => setEvalMode('without-manual')} 
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${evalMode === 'without-manual' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
          >
            Full Automated Audit
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <FileUploader 
          label="Answer Sheet" 
          description="PDF or Word (Student Work)" 
          onFileSelect={setSourceDoc} 
          selectedFile={sourceDoc} 
          icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>} 
        />
        {evalMode === 'with-manual' && (
          <FileUploader 
            label="Faculty Notes" 
            description="Images or PDF (Manual Markings)" 
            onFileSelect={setDirtyFeedbackDoc} 
            selectedFile={dirtyFeedbackDoc} 
            icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>} 
          />
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 border border-red-100 text-sm font-bold flex gap-3 items-center">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
          {error}
        </div>
      )}

      <button 
        onClick={handleAnalyze} 
        disabled={isLoading || !sourceDoc} 
        className="w-full bg-slate-900 hover:bg-slate-800 text-white py-5 rounded-2xl font-black text-lg transition-all shadow-xl disabled:opacity-50"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-3">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
            {loadingStep || "Processing..."}
          </span>
        ) : "Generate Audit Report"}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-50 no-print shadow-sm">
        <div className="flex items-center gap-2 font-black text-slate-900">
          <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center text-white italic">A</div>
          <span>GURU ENGINE</span>
        </div>
        {view === 'report' && (
          <div className="flex gap-2">
            <button onClick={() => setView('dashboard')} className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900">Back</button>
            <button onClick={() => window.print()} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:bg-red-700 transition-colors">Print PDF</button>
          </div>
        )}
      </nav>
      <main className="flex-grow">
        {view === 'dashboard' ? renderDashboard() : <FeedbackReport report={report} />}
      </main>
      <footer className="py-6 text-center text-slate-400 text-xs font-medium border-t border-slate-200 no-print">
        © 2025 AnatomyGuru Medical Education Research Unit
      </footer>
    </div>
  );
};

export default App;