import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Web",
  description: "Web UI for the open-source Codex CLI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
