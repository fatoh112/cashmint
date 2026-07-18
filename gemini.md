# Belburger POS System Architecture Rules

## Core Identity
- This is a Pure Web App (PWA) designed for SaaS scalability. 
- No Native mobile code. No .exe desktop apps.

## Tech Stack
- Frontend: React.js (Vite), Tailwind CSS.
- Backend & DB: Supabase (PostgreSQL, Edge Functions).
- Integrations:
  - Orders: HubRise API via Webhooks.
  - Payments: Deep Linking to external apps (Viva Wallet/SumUp) using URI schemes.
  - Printing: Direct ESC/POS commands to Local IP Printer (Epson TM-M30) via TCP/WebSocket.

## Coding Guidelines
- UI/UX: Always use Arabic (RTL) layout first.
- State Management: Keep cart logic pure and separate from UI components.
- Database: Always enforce Row Level Security (RLS) policies for Supabase tables.
- API/Webhooks: Validate incoming HubRise JSON payloads strictly before inserting into PostgreSQL.