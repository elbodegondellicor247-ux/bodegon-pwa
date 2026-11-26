import React from 'react';
import { CATEGORIES, type ProductCategory } from '../types/store';

interface CategoryBarProps {
  selected: ProductCategory;
  onSelect: (category: ProductCategory) => void;
}

export const CategoryBar: React.FC<CategoryBarProps> = ({ selected, onSelect }) => {
  return (
    <nav
      aria-label="Categorías de productos"
      className="border-b border-[#1B4F9C]/15 bg-white"
    >
      <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {CATEGORIES.map((category) => {
          const isActive = selected === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => onSelect(category)}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap shrink-0 border ${
                isActive
                  ? 'bg-[#072146] text-[#F5A623] border-[#072146] shadow-sm'
                  : 'bg-[#F4F6F9] text-[#072146] border-[#1B4F9C]/15 hover:border-[#1B4F9C] hover:bg-white'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
