import * as React from 'react';
import { cn } from '@/lib/utils';

interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  className?: string;
  disabled?: boolean;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ min = 0, max = 100, step = 1, value, defaultValue, onValueChange, className, disabled }, ref) => {
    const current = value?.[0] ?? defaultValue?.[0] ?? min;
    const pct = ((current - min) / (max - min)) * 100;
    return (
      <input
        ref={ref} type="range" min={min} max={max} step={step} value={current} disabled={disabled}
        onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
        className={cn(
          'w-full h-2 rounded-full appearance-none cursor-pointer bg-secondary outline-none',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        style={{ background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--secondary)) ${pct}%)` }}
      />
    );
  },
);
Slider.displayName = 'Slider';

export { Slider };
