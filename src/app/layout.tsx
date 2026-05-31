import Header from "../components/Header";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "QuikType — Speed Typing Test",
  description:
    "Test and improve your typing speed with solo practice or multiplayer races. Track WPM, accuracy, and compete with friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="grid-bg">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="pt-6 pb-4">
            <Header />
          </div>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
