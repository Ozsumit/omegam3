import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateNumericId(): string {
  // Back to 4 digits as requested
  return Math.floor(1000 + Math.random() * 9000).toString();
}
