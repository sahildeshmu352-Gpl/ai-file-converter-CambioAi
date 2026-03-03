import React, { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as pdfjs from 'pdfjs-dist';
import pptxgen from 'pptxgenjs';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  Plus, X, Download, FileText, Layout, Wand2, Loader2, ArrowRight, 
  FileCode, FileImage, ChevronDown, Check, Menu, MessageSquare, ChevronLeft, ChevronRight, FolderSync
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { editImageWithAI } from './services/gemini';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

type OutputFormat = 'pptx' | 'pdf' | 'txt' | 'png';

interface Tab {
  id: string;
  title: string;
  type: 'home' | 'editor';
  file?: File;
  pages?: string[];
  isConverting?: boolean;
  targetFormat: OutputFormat;
}

const SUPPORTED_INPUTS = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'text/plain': ['.txt'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'application/rtf': ['.rtf'],
};

const FORMATS: { id: OutputFormat; label: string; icon: any }[] = [
  { id: 'pptx', label: 'PowerPoint (.pptx)', icon: Layout },
  { id: 'pdf', label: 'PDF Document (.pdf)', icon: FileText },
  { id: 'txt', label: 'Plain Text (.txt)', icon: FileCode },
  { id: 'png', label: 'Images (.png)', icon: FileImage },
];

function FormatSelectorDropdown({ value, onChange }: { value: OutputFormat, onChange: (v: OutputFormat) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = FORMATS.find(f => f.id === value) || FORMATS[0];

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#2f2f2f] border border-[#3c3c3c] rounded-lg text-sm font-medium hover:bg-[#3c3c3c] transition-colors"
      >
        <selected.icon className="w-4 h-4" />
        <span className="hidden sm:inline">{selected.label}</span>
        <span className="sm:hidden">{selected.id.toUpperCase()}</span>
        <ChevronDown className="w-4 h-4 text-[#878787]" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="absolute right-0 top-full mt-2 w-64 bg-[#2f2f2f] rounded-2xl border border-[#3c3c3c] shadow-2xl z-50 overflow-hidden py-2"
            >
              <div className="px-4 py-2 text-xs font-medium text-[#878787]">Target Format:</div>
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onChange(f.id);
                    setIsOpen(false);
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#3c3c3c] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <f.icon className="w-5 h-5 text-[#ececec]" />
                    <span className="text-[#ececec] text-sm font-medium">{f.label}</span>
                  </div>
                  {value === f.id && <Check className="w-5 h-5 text-[#ececec]" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'home', title: 'New Conversion', type: 'home', targetFormat: 'pptx' }]);
  const [activeTabId, setActiveTabId] = useState('home');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const addTab = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    setTabs([...tabs, { id: newId, title: 'New Conversion', type: 'home', targetFormat: 'pptx' }]);
    setActiveTabId(newId);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = tabs.filter(t => t.id !== id);
    if (newTabs.length === 0) {
      setTabs([{ id: 'home', title: 'New Conversion', type: 'home', targetFormat: 'pptx' }]);
      setActiveTabId('home');
    } else {
      setTabs(newTabs);
      if (activeTabId === id) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
    }
  };

  const processFile = async (file: File, targetFormat: OutputFormat): Promise<string[]> => {
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const images: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          images.push(canvas.toDataURL('image/png'));
        }
      }
      return images;
    }

    if (fileName.endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const container = document.createElement('div');
      container.innerHTML = result.value;
      container.style.width = '800px';
      container.style.padding = '40px';
      container.style.background = 'white';
      container.style.color = 'black';
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      document.body.appendChild(container);
      const canvas = await html2canvas(container);
      document.body.removeChild(container);
      return [canvas.toDataURL('image/png')];
    }

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const html = XLSX.utils.sheet_to_html(firstSheet);
      const container = document.createElement('div');
      container.innerHTML = html;
      container.style.padding = '20px';
      container.style.background = 'white';
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      document.body.appendChild(container);
      const canvas = await html2canvas(container);
      document.body.removeChild(container);
      return [canvas.toDataURL('image/png')];
    }

    if (fileName.endsWith('.txt')) {
      const text = await file.text();
      const container = document.createElement('div');
      container.innerText = text;
      container.style.width = '800px';
      container.style.padding = '40px';
      container.style.background = 'white';
      container.style.color = 'black';
      container.style.whiteSpace = 'pre-wrap';
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      document.body.appendChild(container);
      const canvas = await html2canvas(container);
      document.body.removeChild(container);
      return [canvas.toDataURL('image/png')];
    }

    if (fileType.startsWith('image/')) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve([e.target?.result as string]);
        reader.readAsDataURL(file);
      });
    }

    throw new Error('Unsupported file type');
  };

  const handleFileUpload = async (files: File[], targetFormat: OutputFormat = 'pptx') => {
    if (!files || files.length === 0) return;

    const isMultipleImages = files.length > 1 && files.every(f => f.type.startsWith('image/'));
    
    if (files.length > 1 && !isMultipleImages) {
      alert('You can only upload multiple files if they are all images.');
      return;
    }

    const title = isMultipleImages ? 'Combined Images' : files[0].name;

    setTabs(prev => prev.map(t => 
      t.id === activeTabId ? { ...t, title, type: 'editor', file: files[0], isConverting: true, targetFormat } : t
    ));

    try {
      let allPages: string[] = [];
      if (isMultipleImages) {
        for (const file of files) {
          const pages = await processFile(file, targetFormat);
          allPages.push(...pages);
        }
      } else {
        allPages = await processFile(files[0], targetFormat);
      }

      setTabs(prev => prev.map(t => 
        t.id === activeTabId ? { ...t, pages: allPages, isConverting: false } : t
      ));
    } catch (error) {
      console.error('Conversion error:', error);
      alert('Failed to process file. Please try another format.');
      setTabs(prev => prev.map(t => 
        t.id === activeTabId ? { ...t, isConverting: false } : t
      ));
    }
  };

  const downloadResult = async () => {
    if (!activeTab.pages) return;
    const { targetFormat, pages, title } = activeTab;
    const baseName = title.split('.')[0];

    if (targetFormat === 'pptx') {
      const pres = new pptxgen();
      const slideWidth = 10;
      const slideHeight = 5.625;

      for (let i = 0; i < pages.length; i++) {
        const imgData = pages[i];
        const img = new Image();
        img.src = imgData;
        await new Promise((resolve) => { img.onload = resolve; });
        
        const imgRatio = img.width / img.height;
        const slideRatio = slideWidth / slideHeight;
        
        let renderWidth = slideWidth;
        let renderHeight = slideHeight;
        
        if (imgRatio > slideRatio) {
          renderHeight = slideWidth / imgRatio;
        } else {
          renderWidth = slideHeight * imgRatio;
        }
        
        const x = (slideWidth - renderWidth) / 2;
        const y = (slideHeight - renderHeight) / 2;
        
        const slide = pres.addSlide();
        slide.addImage({ data: imgData, x: x, y: y, w: renderWidth, h: renderHeight });
      }
      await pres.writeFile({ fileName: `${baseName}.pptx` });
    } else if (targetFormat === 'pdf') {
      let pdf: jsPDF | null = null;
      for (let i = 0; i < pages.length; i++) {
        const imgData = pages[i];
        const img = new Image();
        img.src = imgData;
        await new Promise((resolve) => { img.onload = resolve; });
        
        const imgWidth = img.width;
        const imgHeight = img.height;
        const orientation = imgWidth > imgHeight ? 'l' : 'p';
        
        if (i === 0) {
          pdf = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [imgWidth, imgHeight]
          });
          pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        } else {
          pdf!.addPage([imgWidth, imgHeight], orientation);
          pdf!.setPage(i + 1);
          pdf!.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        }
      }
      pdf?.save(`${baseName}.pdf`);
    } else if (targetFormat === 'txt') {
      const text = activeTab.file?.type === 'text/plain' ? await activeTab.file.text() : "Text extraction from this format is not supported yet.";
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.txt`;
      a.click();
    } else if (targetFormat === 'png') {
      pages.forEach((imgData, i) => {
        const a = document.createElement('a');
        a.href = imgData;
        a.download = `${baseName}_page_${i + 1}.png`;
        a.click();
      });
    }
  };

  const handleAiEdit = async (pageIndex: number) => {
    if (!activeTab.pages || !aiPrompt) return;
    setIsAiLoading(true);
    try {
      const editedImage = await editImageWithAI(activeTab.pages[pageIndex], aiPrompt);
      const newPages = [...activeTab.pages];
      newPages[pageIndex] = editedImage;
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, pages: newPages } : t));
      setAiPrompt('');
    } catch (error) {
      console.error('AI Edit failed:', error);
      alert('AI editing failed.');
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#212121] text-[#ececec] font-sans overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/50 z-30 md:hidden"
            />
            <motion.div 
              key="sidebar"
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="fixed md:relative z-40 w-[260px] h-full bg-[#171717] flex flex-col flex-shrink-0"
            >
              <div className="p-3 flex items-center justify-between">
                <button 
                  onClick={addTab}
                  className="flex-1 flex items-center gap-2 px-3 py-2 hover:bg-[#212121] rounded-lg transition-colors text-sm font-medium"
                >
                  <div className="bg-[#ececec] text-[#171717] p-1 rounded-full">
                    <Plus className="w-4 h-4" />
                  </div>
                  New Conversion
                </button>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="md:hidden p-2 hover:bg-[#212121] rounded-lg ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 no-scrollbar">
                <div className="text-xs font-medium text-[#878787] px-2 py-2">Today</div>
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    onClick={() => {
                      setActiveTabId(tab.id);
                      if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={cn(
                      "group relative flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors text-sm",
                      activeTabId === tab.id ? "bg-[#212121]" : "hover:bg-[#212121]"
                    )}
                  >
                    <MessageSquare className="w-4 h-4 text-[#ececec]" />
                    <span className="truncate flex-1">{tab.title}</span>
                    {tabs.length > 1 && (
                      <button
                        onClick={(e) => closeTab(tab.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-white text-[#878787] transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Top Bar */}
        <div className="h-14 flex items-center px-4 gap-2 sticky top-0 bg-[#212121] z-10">
          {!isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-[#2f2f2f] rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1 flex items-center justify-between">
            <span className="font-medium text-lg px-2 hidden sm:block">Cambio 4.0</span>
            <div className="flex-1 flex items-center justify-end gap-2">
              {activeTab.type === 'editor' && (
                <>
                  <FormatSelectorDropdown 
                    value={activeTab.targetFormat} 
                    onChange={(fmt) => setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, targetFormat: fmt } : t))} 
                  />
                  <button 
                    onClick={downloadResult}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#ececec] text-[#171717] rounded-lg text-sm font-medium hover:bg-[#d4d4d4] transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Download</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto no-scrollbar pb-32">
          <AnimatePresence mode="wait">
            {activeTab.type === 'home' ? (
              <HomeView key="home" onUpload={handleFileUpload} />
            ) : (
              <EditorView 
                key="editor"
                tab={activeTab} 
                onAiEdit={handleAiEdit}
                isAiLoading={isAiLoading}
                aiPrompt={aiPrompt}
                setAiPrompt={setAiPrompt}
              />
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function HomeView({ onUpload }: { key?: string | number, onUpload: (files: File[], target: OutputFormat) => void }) {
  const [targetFormat, setTargetFormat] = useState<OutputFormat>('pptx');
  const [showFormatMenu, setShowFormatMenu] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles: File[]) => onUpload(acceptedFiles, targetFormat),
    accept: SUPPORTED_INPUTS as any,
    multiple: true
  } as any);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-full flex flex-col p-4 sm:p-8 max-w-3xl mx-auto w-full"
    >
      <div className="m-auto w-full py-8">
        <div className="mb-8 text-center">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shrink-0">
            <FolderSync className="w-8 h-8 text-[#171717]" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold mb-2">Welcome to Cambio Ai!</h1>
        </div>

        <div className="w-full bg-[#2f2f2f] rounded-3xl p-4 sm:p-6 shadow-lg border border-[#3c3c3c]">
        <div className="mb-6">
          <div className="text-sm font-medium text-[#ececec] mb-2">Target Format:</div>
          <div className="relative">
            <button 
              onClick={() => setShowFormatMenu(!showFormatMenu)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-[#212121] rounded-xl border border-[#3c3c3c] hover:bg-[#3c3c3c] transition-all"
            >
              <div className="flex items-center gap-3">
                {React.createElement(FORMATS.find(f => f.id === targetFormat)?.icon || Layout, { className: "w-5 h-5 text-[#ececec]" })}
                <span className="font-medium">{FORMATS.find(f => f.id === targetFormat)?.label}</span>
              </div>
              <ChevronDown className="w-5 h-5 text-[#878787]" />
            </button>
            
            <AnimatePresence>
              {showFormatMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFormatMenu(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute top-full left-0 mt-2 w-full bg-[#2f2f2f] rounded-2xl border border-[#3c3c3c] shadow-2xl z-50 overflow-hidden py-2"
                  >
                    {FORMATS.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          setTargetFormat(f.id);
                          setShowFormatMenu(false);
                        }}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#3c3c3c] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <f.icon className="w-5 h-5 text-[#ececec]" />
                          <span className="text-sm font-medium text-[#ececec]">{f.label}</span>
                        </div>
                        {targetFormat === f.id && <Check className="w-5 h-5 text-[#ececec]" />}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div 
          {...getRootProps()} 
          className={cn(
            "w-full rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center cursor-pointer py-12 px-4 text-center",
            isDragActive 
              ? "border-white bg-white/5" 
              : "border-[#565869] hover:border-[#ececec] hover:bg-[#3c3c3c]"
          )}
        >
          <input {...getInputProps()} />
          <Plus className="w-8 h-8 mb-4 text-[#ececec]" />
          <p className="text-lg font-medium mb-1">
            {isDragActive ? "Drop file here" : "Upload file(s) to convert"}
          </p>
          <p className="text-sm text-[#878787]">PDF, Word, Excel, Images, Text (Select multiple images to combine)</p>
        </div>
      </div>
      </div>
    </motion.div>
  );
}

function EditorView({ 
  tab, 
  onAiEdit,
  isAiLoading,
  aiPrompt,
  setAiPrompt,
}: { 
  key?: string | number;
  tab: Tab; 
  onAiEdit: (index: number) => Promise<void> | void;
  isAiLoading: boolean;
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
}) {
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);

  if (tab.isConverting) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-lg font-medium">Processing file...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto px-4 sm:px-6 relative">
      <div className="flex-1 overflow-y-auto py-6 no-scrollbar flex flex-col items-center">
        {/* Main Canvas */}
        <div className="w-full max-w-2xl relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedPageIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="relative shadow-lg rounded-lg overflow-hidden bg-white mx-auto"
            >
              {tab.pages && (
                <img 
                  src={tab.pages[selectedPageIndex]} 
                  alt="Current Page" 
                  className="w-full h-auto object-contain"
                />
              )}
              
              {isAiLoading && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center z-50">
                  <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
                  <p className="text-sm font-medium text-white">Applying AI edits...</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Page Navigation */}
          {tab.pages && tab.pages.length > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button 
                onClick={() => setSelectedPageIndex(Math.max(0, selectedPageIndex - 1))}
                disabled={selectedPageIndex === 0}
                className="p-2 rounded-full hover:bg-[#2f2f2f] disabled:opacity-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm font-medium">
                {selectedPageIndex + 1} / {tab.pages.length}
              </span>
              <button 
                onClick={() => setSelectedPageIndex(Math.min(tab.pages!.length - 1, selectedPageIndex + 1))}
                disabled={selectedPageIndex === tab.pages.length - 1}
                className="p-2 rounded-full hover:bg-[#2f2f2f] disabled:opacity-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Input Bar at Bottom */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[260px] bg-gradient-to-t from-[#212121] via-[#212121] to-transparent pt-6 pb-6 px-4 pointer-events-none z-20">
        <div className="max-w-3xl mx-auto relative pointer-events-auto">
          <div className="bg-[#2f2f2f] rounded-3xl p-2 shadow-xl border border-[#3c3c3c] flex flex-col">
            <div className="flex items-center px-2 py-1">
              <input 
                type="text"
                placeholder="Message Cambio Ai to edit this slide..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAiEdit(selectedPageIndex)}
                className="flex-1 bg-transparent border-none outline-none text-base py-2 px-2 placeholder-[#878787]"
              />
              <button 
                disabled={!aiPrompt || isAiLoading}
                onClick={() => onAiEdit(selectedPageIndex)}
                className="p-2 rounded-full bg-white text-black disabled:bg-[#3c3c3c] disabled:text-[#878787] transition-colors ml-2"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="text-center mt-2 text-xs text-[#878787]">
            Cambio Ai can make mistakes. Check important info.
          </div>
        </div>
      </div>
    </div>
  );
}
