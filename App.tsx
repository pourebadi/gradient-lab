
import React, { useEffect } from 'react';
import { InfiniteCanvas } from './components/Canvas/InfiniteCanvas';
import { BottomToolbar } from './components/UI/BottomToolbar';
import { useStore } from './store';

const App = () => {
  const { undo, redo, theme, fitContent } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    fitContent(undefined, 0.75);
  }, []);

  return (
    <div className="w-full h-full relative font-sans text-zinc-900 dark:text-white bg-zinc-100 dark:bg-zinc-950 overflow-hidden transition-colors duration-200">
      <div className="absolute top-6 left-6 z-50 pointer-events-none">
         <span className="font-bold tracking-tight text-lg bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent opacity-80">
            Gradient Architect
         </span>
      </div>
      <div className="w-full h-full">
        <InfiniteCanvas />
      </div>
      <BottomToolbar />
    </div>
  );
};

export default App;
