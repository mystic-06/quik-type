import Header from "../components/Header";
import type { Metadata } from "next";
import { Rubik, Space_Mono } from "next/font/google";
import "./globals.css";

const rubik = Rubik({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-rubik", 
});

const space_mono = Space_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400","700"],
  variable: "--font-space-mono"
})
export const metadata: Metadata = {
  title: "QuikType",
  description: "A speed typing test website.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${rubik.variable} ${space_mono.variable}`}>
      <body>
          <div className="flex justify-center mt-2">
            <Header />
          </div>
          {children}
      </body>
    </html>
  );
}
