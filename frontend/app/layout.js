import "./globals.css";

export const metadata = {
  title: "Dry Dock 2026 — team app",
  description: "Your team's Dry Dock 2026 project. Shipped via VanderBot.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
