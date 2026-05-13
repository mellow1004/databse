import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Brightvision Master Database",
  description: "Internal GTME operations console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} h-full`}
    >
      <body className="min-h-full font-sans antialiased bg-slate-50 text-slate-900">
        {children}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
