"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Wraps next-themes. Dark-first: defaultTheme="dark".
 * next-themes toggles the "dark"/"light" class on <html>; our CSS uses
 * `:root` as the dark baseline and `.light` for overrides, so we tell
 * next-themes to apply the light theme via the `.light` class name.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      value={{ dark: "dark", light: "light" }}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
