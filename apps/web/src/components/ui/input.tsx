import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("w-full rounded-md border border-[#d9d3c7] bg-white px-3 py-2 text-sm outline-none focus:border-[#1c1915]", className)}
      {...props}
    />
  );
}
