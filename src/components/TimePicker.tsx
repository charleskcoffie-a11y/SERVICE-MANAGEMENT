import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Delete } from 'lucide-react';

interface TimePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  type: 'time' | 'duration'; // time is HH:MM, duration is just minutes
}

export const TimePicker: React.FC<TimePickerProps> = ({ isOpen, onClose, onConfirm, title, type }) => {
  const [value, setValue] = useState('');
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');

  const handleKeyClick = (key: string) => {
    if (type === 'duration') {
      if (value.length < 3) setValue(prev => prev + key);
    } else {
      if (value.length < 4) setValue(prev => prev + key);
    }
  };

  const handleDelete = () => {
    setValue(prev => prev.slice(0, -1));
  };

  const handleConfirm = () => {
    if (type === 'time') {
      if (value.length === 4) {
        const hh = value.slice(0, 2);
        const mm = value.slice(2, 4);
        onConfirm(`${hh}:${mm} ${period}`);
      }
    } else {
      onConfirm(value || '0');
    }
    setValue('');
    onClose();
  };

  const formattedDisplay = () => {
    if (type === 'time') {
      const padded = value.padEnd(4, '_');
      return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
    }
    return value || '0';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl p-8 w-full max-w-sm shadow-2xl"
          >
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-zinc-500 font-mono text-xs tracking-widest uppercase">{title}</h3>
              <button onClick={onClose} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-zinc-950 border border-white/5 rounded-2xl p-6 mb-8 text-center relative overflow-hidden">
              <div className="text-5xl font-mono font-bold tracking-tighter text-emerald-400">
                {formattedDisplay()}
                <span className="text-xs text-zinc-600 ml-2 uppercase tracking-widest">
                  {type === 'time' ? period : 'MINS'}
                </span>
              </div>
            </div>

            {type === 'time' && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button
                  onClick={() => setPeriod('AM')}
                  className={`py-3 rounded-xl font-bold transition-all ${period === 'AM' ? 'bg-emerald-500 text-black' : 'bg-white/5 text-zinc-400'}`}
                >
                  AM
                </button>
                <button
                  onClick={() => setPeriod('PM')}
                  className={`py-3 rounded-xl font-bold transition-all ${period === 'PM' ? 'bg-emerald-500 text-black' : 'bg-white/5 text-zinc-400'}`}
                >
                  PM
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  onClick={() => handleKeyClick(num.toString())}
                  className="h-16 bg-white/5 hover:bg-white/10 rounded-xl text-2xl font-bold transition-colors"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={handleDelete}
                className="h-16 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-zinc-400"
              >
                <Delete className="w-6 h-6" />
              </button>
              <button
                onClick={() => handleKeyClick('0')}
                className="h-16 bg-white/5 hover:bg-white/10 rounded-xl text-2xl font-bold transition-colors"
              >
                0
              </button>
              <button
                onClick={handleConfirm}
                className="h-16 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-black font-black text-sm tracking-widest"
              >
                SET
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
