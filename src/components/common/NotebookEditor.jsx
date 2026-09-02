import React, { useState, useRef, useEffect } from "react";

// Helper: Safely generates a unique ID for drag-and-drop mapping
const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper: Applies styles based ONLY on standard AI-friendly Markdown
const getStyleForLine = (text, isLocked) => {
  const base = `w-full resize-none bg-transparent border-none py-1.5 px-2 leading-relaxed focus:ring-0 focus:outline-none overflow-hidden transition-all ${isLocked ? 'opacity-80' : ''} `;
  
  // Standard Markdown Divider
  if (text.trim() === "---") return base + "text-transparent bg-slate-300 h-[6px] rounded-full my-4 cursor-default tracking-[2em]";
  
  // Standard Markdown Headings (Font Sizes)
  if (text.startsWith("# ")) return base + "text-2xl font-black text-slate-900 border-b border-slate-200 mt-4 mb-2";
  if (text.startsWith("## ")) return base + "text-xl font-bold text-slate-800 mt-3 mb-1";
  if (text.startsWith("### ")) return base + "text-lg font-semibold text-slate-800 mt-2";
  
  // Standard Markdown Blockquote (Visual Highlight/Italic)
  if (text.startsWith("> ")) return base + "text-[15px] border-l-4 border-blue-500 pl-4 italic text-slate-700 bg-blue-50 py-2 mt-1 mb-1 rounded-r-md";
  
  // Default Paragraph
  return base + "text-[14px] text-slate-800";
};

export default function NotebookEditor({ initialText = "", onSave, onCancel }) {
  const [blocks, setBlocks] = useState(() => {
    const split = initialText.split("\n");
    if (split.length === 0 || (split.length === 1 && split[0] === "")) {
      return [{ id: generateId(), text: "", isLocked: false }];
    }
    return split.map(text => ({
      id: generateId(),
      text: text,
      isLocked: text.trim() !== "" // Lock by default if it contains text
    }));
  });
  
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputsRef = useRef([]);

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // Auto-resize all textareas
  useEffect(() => {
    inputsRef.current.forEach(input => {
      if (input) {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
      }
    });
  }, [blocks]);

  const updateBlockText = (index, value) => {
    if (blocks[index].isLocked) return;
    const newBlocks = [...blocks];
    newBlocks[index].text = value;
    setBlocks(newBlocks);
  };

  const toggleLock = (index) => {
    const newBlocks = [...blocks];
    newBlocks[index].isLocked = !newBlocks[index].isLocked;
    setBlocks(newBlocks);
  };

  // Safe formatting using standard Markdown ONLY
  const togglePrefix = (prefix) => {
    if (focusedIndex === null) return;
    if (blocks[focusedIndex].isLocked) {
      alert("Please unlock this block first to format it.");
      return;
    }
    
    const newBlocks = [...blocks];
    const currentText = newBlocks[focusedIndex].text;
    
    // Only strip standard Markdown prefixes
    const cleanText = currentText.replace(/^(# |## |### |> )/, "");
    
    if (currentText.startsWith(prefix)) {
      newBlocks[focusedIndex].text = cleanText;
    } else {
      newBlocks[focusedIndex].text = prefix + cleanText;
    }
    
    setBlocks(newBlocks);
    inputsRef.current[focusedIndex]?.focus();
  };

  const insertBlockBelow = (index, text = "") => {
    const newBlocks = [...blocks];
    newBlocks.splice(index + 1, 0, { id: generateId(), text: text, isLocked: false });
    setBlocks(newBlocks);
    setTimeout(() => inputsRef.current[index + 1]?.focus(), 10);
  };

  const handleKeyDown = (index, e) => {
    if (blocks[index].isLocked) {
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
        e.preventDefault();
        alert("This block is locked. Click the padlock icon to unlock and edit.");
      }
      return;
    }

    const cursorPos = e.target.selectionStart;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = blocks[index].text;
      const before = text.slice(0, cursorPos);
      const after = text.slice(cursorPos);
      
      const newBlocks = [...blocks];
      newBlocks[index].text = before;
      newBlocks.splice(index + 1, 0, { id: generateId(), text: after, isLocked: false });
      setBlocks(newBlocks);
      
      setTimeout(() => {
        const nextInput = inputsRef.current[index + 1];
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(0, 0);
        }
      }, 10);
    } 
    else if (e.key === "Backspace" && cursorPos === 0 && index > 0) {
      e.preventDefault();
      if (blocks[index - 1].isLocked) {
        alert("The block above is locked. You cannot merge into it.");
        return;
      }
      
      const currentText = blocks[index].text;
      const prevText = blocks[index - 1].text;
      const newBlocks = [...blocks];
      
      newBlocks[index - 1].text = prevText + currentText;
      newBlocks.splice(index, 1);
      setBlocks(newBlocks);
      
      setTimeout(() => {
        const prevInput = inputsRef.current[index - 1];
        if (prevInput) {
          prevInput.focus();
          const pos = prevText.length;
          prevInput.setSelectionRange(pos, pos);
        }
      }, 10);
    }
    else if (e.key === "ArrowUp" && cursorPos === 0 && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    }
    else if (e.key === "ArrowDown" && cursorPos === blocks[index].text.length && index < blocks.length - 1) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  };

  const deleteBlock = (index) => {
    const blockText = blocks[index].text.trim();
    if (blockText !== "" && blockText !== "---") {
      const confirmDelete = window.confirm("Are you sure you want to delete this text block? This action cannot be undone.");
      if (!confirmDelete) return;
    }
    
    const newBlocks = blocks.filter((_, i) => i !== index);
    setBlocks(newBlocks.length > 0 ? newBlocks : [{ id: generateId(), text: "", isLocked: false }]);
  };

  const handleDragStart = (e, index) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => { e.target.classList.add("opacity-50"); }, 0);
  };

  const handleDragEnter = (e, index) => { dragOverItem.current = index; };

  const handleDragEnd = (e) => {
    e.target.classList.remove("opacity-50");
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    const newBlocks = [...blocks];
    const draggedItemContent = newBlocks.splice(dragItem.current, 1)[0];
    newBlocks.splice(dragOverItem.current, 0, draggedItemContent);
    
    setBlocks(newBlocks);
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleCopyAll = () => navigator.clipboard.writeText(blocks.map(b => b.text).join("\n"));
  
  const handleClearAll = () => { 
    if (window.confirm("WARNING: Are you sure you want to clear all text completely?")) {
      setBlocks([{ id: generateId(), text: "", isLocked: false }]);
    } 
  };

  const handleSave = () => {
    let cleanedBlocks = [...blocks];
    while (cleanedBlocks.length > 1 && cleanedBlocks[cleanedBlocks.length - 1].text.trim() === "") {
      cleanedBlocks.pop();
    }
    onSave(cleanedBlocks.map(b => b.text).join("\n"));
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* CLEAN FORMATTING TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm gap-4">
        
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => togglePrefix("# ")} title="Large Heading" className="px-2 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded">H1</button>
          <button onClick={() => togglePrefix("## ")} title="Medium Heading" className="px-2 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded">H2</button>
          <button onClick={() => togglePrefix("### ")} title="Small Heading" className="px-2 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded">H3</button>
          
          <div className="w-px h-5 bg-slate-300 mx-1"></div>
          
          <button onClick={() => togglePrefix("> ")} title="Quote / Highlight" className="px-2 py-1 text-xs font-bold text-blue-700 bg-blue-50 border-l-2 border-blue-500 hover:bg-blue-100 rounded-r">Quote / Highlight</button>
          
          <div className="w-px h-5 bg-slate-300 mx-1"></div>
          
          <button onClick={() => insertBlockBelow(focusedIndex !== null ? focusedIndex : blocks.length - 1, "---")} title="Insert Divider Line Below" className="px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded border border-slate-200">— Line</button>
        </div>

        <div className="flex gap-2 shrink-0">
          <button onClick={handleCopyAll} title="Copy All text" className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
          <button onClick={handleClearAll} title="Clear All text" className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>

      {/* Editor Canvas */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 sm:p-6 space-y-2 min-h-[400px]">
        {blocks.map((block, index) => (
          <div 
            key={block.id} 
            className="flex items-start gap-1 sm:gap-3 group relative rounded-md transition-colors hover:bg-slate-50"
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
          >
            
            <div className="flex flex-col items-center mt-2.5 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex flex-col gap-1.5 items-center">
                <button className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing" title="Drag to reorder">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M4 4h2v2H4V4zm4 0h2v2H8V4zm4 0h2v2h-2V4zM4 8h2v2H4V8zm4 0h2v2H8V8zm4 0h2v2h-2V8zM4 12h2v2H4v-2zm4 0h2v2H8v-2zm4 0h2v2h-2v-2z"/></svg>
                </button>
                <button onClick={() => insertBlockBelow(index)} className="text-slate-400 hover:text-blue-600 bg-white border border-slate-200 rounded shadow-sm" title="Insert new line below">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                </button>
              </div>
            </div>

            <div className="relative flex-1 group/input">
              {!block.isLocked && <div className={`absolute -left-3 top-1 bottom-1 w-1 rounded-full transition-opacity ${focusedIndex === index ? 'bg-blue-400 opacity-100' : 'opacity-0'}`}></div>}
              
              <textarea
                ref={(el) => (inputsRef.current[index] = el)}
                value={block.text}
                onChange={(e) => updateBlockText(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onFocus={() => setFocusedIndex(index)}
                placeholder="Type text, or use toolbar to style..."
                readOnly={block.isLocked}
                rows={1}
                className={`${getStyleForLine(block.text, block.isLocked)} ${block.isLocked ? 'cursor-not-allowed bg-slate-50/50' : ''}`}
              />
            </div>

            <div className="mt-2 flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => toggleLock(index)}
                className={`p-1 rounded ${block.isLocked ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:text-slate-600 hover:bg-slate-200'}`}
                title={block.isLocked ? "Unlock to edit" : "Lock block"}
              >
                {block.isLocked ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" /></svg>
                )}
              </button>
              
              <button 
                onClick={() => deleteBlock(index)}
                className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded"
                title="Delete Block"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 pl-8 mt-4 opacity-70 hover:opacity-100 transition-opacity">
          <button 
            onClick={() => insertBlockBelow(blocks.length - 1)}
            className="text-xs font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50 hover:bg-blue-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            <span>Add new text block</span>
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
        <button onClick={onCancel} className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Discard Changes</button>
        <button onClick={handleSave} className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-blue-600 rounded-lg shadow-md transition-all active:scale-95">Save to Form</button>
      </div>
    </div>
  );
}