import React from 'react';
import { useStore } from '../../store';
import { MousePointer2, Layout, Hand } from 'lucide-react';

const ToolButton = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    title={label}
    className={`p-3 rounded-xl transition-all ${
      active ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:bg-black/5 dark:hover:bg-white/10 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
    }`}
  >
    <Icon size={20} />
  </button>
);

export const Toolbar = () => {
  const { activeTool, setTool } = useStore();

  return (
    <div className="absolute top-1/2 left-4 -translate-y-1/2 flex flex-col gap-2 bg-white dark:bg-zinc-750 p-2 rounded-2xl shadow-2xl border border-zinc-200 dark:border-white/5 z-50 transition-colors duration-200">
      <ToolButton 
        active={activeTool === 'select'} 
        onClick={() => setTool('select')} 
        icon={MousePointer2} 
        label="Select (V)" 
      />
      <ToolButton 
        active={activeTool === 'pan'} 
        onClick={() => setTool('pan')} 
        icon={Hand} 
        label="Pan (H)" 
      />
      <div className="h-px bg-zinc-100 dark:bg-white/10 w-full my-1" />
      <ToolButton 
        active={activeTool === 'artboard'} 
        onClick={() => setTool('artboard')} 
        icon={Layout} 
        label="Artboard (A)" 
      />
    </div>
  );
};