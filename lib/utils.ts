import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateNumericId(): string {
  // Use 8 digits for much lower collision risk (1 in 100 million)
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}
