import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#1c1915] text-[#f4f1ea]",
        ghost: "bg-transparent text-[#1c1915] underline-offset-4 hover:underline",
        danger: "bg-[#7a2e2e] text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
