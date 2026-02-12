import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SWIFT калькулятор комісії (НБУ)",
  description: "Калькулятор комісії SWIFT-платежів по формулі НБУ"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body className="bg-gray-100 min-h-screen flex items-center justify-center p-6 transition-colors">
        {children}
      </body>
    </html>
  );
}

