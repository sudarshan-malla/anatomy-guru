
import React, { useState, useEffect } from 'react';
import { generateStructuredFeedback, EvaluationMode } from './services/geminiService';
import { EvaluationReport, FileData } from './types';
import FileUploader from './components/FileUploader';
import FeedbackReport from './components/FeedbackReport';
// @ts-ignore
import mammoth from 'mammoth';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel, VerticalAlign } from 'docx';

// Safe resolution of PDF.js object for different ESM environments
const pdfjs: any = (pdfjsLib as any).GlobalWorkerOptions 
  ? pdfjsLib 
  : (pdfjsLib as any).default || pdfjsLib;

// Set up PDF.js worker using a compatible CDN for v3.11.174
if (pdfjs && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
}

const App: React.FC = () => {
  const [sourceDoc, setSourceDoc] = useState<File | null>(null);
  const [dirtyFeedbackDoc, setDirtyFeedbackDoc] = useState<File | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'dashboard' | 'report'>('dashboard');
  const [evalMode, setEvalMode] = useState<EvaluationMode>('with-manual');

  // Deployment environment check
  const isApiKeyMissing = !process.env.API_KEY || process.env.API_KEY === 'undefined';

  useEffect(() => {
    if (report) setView('report');
  }, [report]);

  const extractTextFromPDF = async (file: File): Promise<string> => {
    if (!pdfjs || !pdfjs.getDocument) {
      throw new Error("PDF.js library not properly initialized.");
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += `[P${i}] ${pageText}\n`;
    }
    return fullText;
  };

  const processFile = async (file: File): Promise<FileData> => {
    const fileName = file.name.toLowerCase();
    const isDocx = fileName.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isPdf = fileName.endsWith('.pdf') || file.type === 'application/pdf';
    
    if (isDocx) {
      setLoadingStep(`Parsing DOCX: ${file.name}`);
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return { text: result.value, name: file.name, isDocx: true };
    } 
    
    if (isPdf) {
      setLoadingStep(`Extracting PDF: ${file.name}`);
      try {
        const text = await extractTextFromPDF(file);
        if (text.trim().length > 150) {
          return { text, name: file.name, isDocx: false };
        }
      } catch (e) {
        console.warn("PDF extraction fallback to Vision", e);
      }
    }

    setLoadingStep(`Encoding Visual Data: ${file.name}`);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
    });

    return {
      base64,
      mimeType: file.type,
      name: file.name,
      isDocx: false
    };
  };

  const handleAnalyze = async () => {
    if (isApiKeyMissing) {
      setError("API Key Missing: Please set the API_KEY environment variable in your Netlify dashboard.");
      return;
    }

    if (!sourceDoc) {
      setError("Please upload the Student Answer Sheet.");
      return;
    }
    if (evalMode === 'with-manual' && !dirtyFeedbackDoc) {
      setError("Please upload Faculty Notes for manual feedback mode.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const sourceData = await processFile(sourceDoc);
      const feedbackData = evalMode === 'with-manual' && dirtyFeedbackDoc 
        ? await processFile(dirtyFeedbackDoc) 
        : null;

      setLoadingStep("AI performing medical audit...");
      const result = await generateStructuredFeedback(sourceData, feedbackData, evalMode);
      setReport(result);
    } catch (err: any) {
      console.error("Analysis Failure:", err);
      if (err.message?.includes('403') || err.message?.includes('API_KEY_INVALID')) {
        setError("Invalid API Key. Please check your Gemini API credentials in Netlify Settings.");
      } else {
        setError(err.message || "An error occurred during evaluation.");
      }
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleExportPDF = () => {
    if (sourceDoc) {
      const originalTitle = document.title;
      document.title = sourceDoc.name;
      window.print();
      document.title = originalTitle;
    } else {
      window.print();
    }
  };

  const handleExportWord = async () => {
    if (!report) return;

    const sections = [];

    // Header Info
    sections.push(
      new Paragraph({
        children: [new TextRun(report.testTitle || 'Evaluation Report')],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Student Name: `, bold: true }),
          new TextRun({ text: report.studentName || 'N/A' }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Date: `, bold: true }),
          new TextRun({ text: report.testDate || 'N/A' }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Topics: `, bold: true }),
          new TextRun({ text: report.testTopics || 'N/A' }),
        ],
      }),
      new Paragraph({ children: [] }) 
    );

    // Questions Table
    const tableRows = [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Q No", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Feedback", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Marks", bold: true })] })] }),
        ],
      }),
    ];

    report.questions.forEach((q) => {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun(q.qNo + (q.isFlagged ? " (🚩)" : ""))] })] }),
            new TableCell({
              children: q.feedbackPoints.map(p => new Paragraph({ 
                children: [new TextRun("• " + p)], 
                spacing: { before: 100 } 
              })),
            }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun(`${q.marks}`)] })] }),
          ],
        })
      );
    });

    // Total Row
    const calculatedSum = report.questions?.reduce((acc: number, q: any) => acc + (Number(q.marks) || 0), 0) || 0;
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ 
            columnSpan: 2, 
            children: [new Paragraph({ 
              children: [new TextRun({ text: "Total Score Summation", bold: true })], 
              alignment: AlignmentType.RIGHT 
            })] 
          }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${calculatedSum} / ${report.maxScore}`, bold: true })] })] }),
        ],
      })
    );

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
    });

    sections.push(table);
    sections.push(new Paragraph({ children: [] })); // Spacer

    // General Feedback
    const gf = report.generalFeedback;
    const addGfSection = (title: string, items: string[]) => {
      sections.push(new Paragraph({ 
        children: [new TextRun({ text: title, bold: true })], 
        spacing: { before: 200 } 
      }));
      items.forEach(item => {
        sections.push(new Paragraph({ 
          children: [new TextRun("• " + item)], 
          spacing: { before: 100 } 
        }));
      });
    };

    addGfSection("1) Overall Performance", gf.overallPerformance);
    addGfSection("2) MCQs", gf.mcqs);
    addGfSection("3) Content Accuracy", gf.contentAccuracy);
    addGfSection("4) Completeness of Answers", gf.completenessOfAnswers);
    addGfSection("5) Presentation & Diagrams", gf.presentationDiagrams);
    addGfSection("6) Investigations", gf.investigations);
    addGfSection("7) Attempting All Questions", gf.attemptingQuestions);
    addGfSection("8) Action Points", gf.actionPoints);

    const doc = new Document({
      sections: [{
        children: sections,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.studentName || 'Report'}_Evaluation.docx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = () => {
    if (!report) return;
    const dataStr = JSON.stringify(report, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = sourceDoc ? sourceDoc.name.replace(/\.[^/.]+$/, "") : "report";
    const exportFileDefaultName = `${baseName}_analysis.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', url);
    linkElement.setAttribute('download', exportFileDefaultName);
    document.body.appendChild(linkElement);
    linkElement.click();
    document.body.removeChild(linkElement);
    URL.revokeObjectURL(url);
  };

  const renderDashboard = () => (
    <div className="max-w-5xl mx-auto px-4 mt-12 animate-fade-in pb-20">
      <header className="text-center mb-10">
        <h1 className="text-5xl font-black text-slate-900 mb-4 tracking-tighter">
          Medical <span className="text-red-600">Evaluation</span>
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto font-medium">
          Professional medical audit engine. Extracts marks and identifies knowledge gaps with clinical precision.
        </p>
      </header>

      {/* API Key Missing Alert (Only visible if not configured) */}
      {isApiKeyMissing && (
        <div className="mb-10 bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center gap-4 text-amber-800 animate-pulse">
           <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
           <p className="text-sm font-medium">
             <strong>Deployment Notice:</strong> API Key is not configured. Please add <code>API_KEY</code> to your Netlify Environment Variables.
           </p>
        </div>
      )}

      {/* Toggle Mode */}
      <div className="flex justify-center mb-10">
        <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center shadow-inner border border-slate-200">
          <button 
            onClick={() => setEvalMode('with-manual')}
            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${evalMode === 'with-manual' ? 'bg-white shadow-md text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            With Manual Feedback
          </button>
          <button 
            onClick={() => setEvalMode('without-manual')}
            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${evalMode === 'without-manual' ? 'bg-white shadow-md text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            Automated (Key Only)
          </button>
        </div>
      </div>

      <div className={`grid gap-8 mb-12 h-full ${evalMode === 'with-manual' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 max-w-lg mx-auto'}`}>
        <FileUploader
          label="Student Answer Sheet"
          description="Source PDF or DOCX file (Must contain Key)"
          onFileSelect={setSourceDoc}
          selectedFile={sourceDoc}
          icon={<svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>}
        />
        {evalMode === 'with-manual' && (
          <FileUploader
            label="Faculty Notes"
            description="Evaluator marks and handwritten comments"
            onFileSelect={setDirtyFeedbackDoc}
            selectedFile={dirtyFeedbackDoc}
            icon={<svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>}
          />
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-6 rounded-2xl mb-8 flex items-start gap-4 animate-shake shadow-lg">
          <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center shrink-0 text-rose-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
          </div>
          <div>
            <p className="font-black uppercase tracking-widest text-[10px] mb-1">Processing Error</p>
            <span className="font-semibold text-base">{error}</span>
          </div>
        </div>
      )}

      <button
        onClick={handleAnalyze}
        disabled={isLoading || !sourceDoc || (evalMode === 'with-manual' && !dirtyFeedbackDoc)}
        className={`w-full py-6 rounded-2xl font-black text-xl shadow-2xl transition-all flex flex-col items-center justify-center gap-1 relative overflow-hidden ${
          isLoading 
          ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
          : 'bg-slate-900 hover:bg-slate-800 text-white hover:-translate-y-1 active:scale-95'
        }`}
      >
        {isLoading ? (
          <>
            <div className="flex items-center gap-4">
              <svg className="animate-spin h-6 w-6 text-red-500" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              <span className="animate-pulse tracking-widest uppercase text-sm font-black">Synthesizing Feedback</span>
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 opacity-70">
              {loadingStep}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            Generate Professional Feedback
          </div>
        )}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <nav className="bg-white/95 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-50 no-print h-16 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center">
             {view === 'report' ? (
              <button 
                onClick={() => {
                  setReport(null);
                  setView('dashboard');
                  setError(null);
                }}
                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-bold transition-all text-sm group"
              >
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                </div>
                New Analysis
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white font-black text-xl italic">A</div>
                <span className="font-black text-slate-900 tracking-tighter uppercase text-sm">Guru Engine</span>
              </div>
            )}
          </div>
          
          {view === 'report' && report && (
            <div className="flex items-center gap-2 sm:gap-3">
              <button 
                onClick={handleDownloadJSON}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border border-slate-300"
                title="Download JSON Report"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                <span className="hidden lg:inline">JSON</span>
              </button>
              <button 
                onClick={handleExportWord}
                className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-xl shadow-blue-500/10"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                Export Word
              </button>
              <button 
                onClick={handleExportPDF}
                className="px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-xl shadow-red-500/10"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 00-2 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                Export PDF
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4">
        {view === 'dashboard' ? renderDashboard() : <FeedbackReport report={report} />}
      </main>

      <footer className="mt-20 py-10 border-t border-slate-100 no-print text-center opacity-40">
        <p className="text-xs font-bold uppercase tracking-[0.3em]">Intelligence Engine v4.6.5 (Netlify Optimized)</p>
      </footer>
    </div>
  );
};

export default App;
