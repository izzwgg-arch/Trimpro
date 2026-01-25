# Trim Pro - Field Service Management Platform

Production-ready, multi-tenant SaaS platform for millwork/trim/molding/custom furniture companies.

## Features

- **CRM**: Complete client management with contacts, addresses, communication timeline
- **Scheduling**: Calendar with drag & drop, team availability, conflict detection
- **Jobs**: Full job lifecycle management with crew assignment and media uploads
- **Estimates & Invoices**: Professional estimates and invoicing with PDF generation
- **Payments**: SOLA API integration for secure payment processing
- **QuickBooks Online**: Full OAuth integration with automated sync
- **VoIP Calling**: WebRTC/SIP softphone for web and mobile
- **SMS/MMS**: VoIP.ms integration for text messaging
- **Tasks & Issues**: Comprehensive task management and issue tracking
- **Automations**: Workflow automation with triggers and actions
- **Reports & Analytics**: Business intelligence and reporting

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: PostgreSQL
- **Cache/Queue**: Redis
- **Realtime**: Socket.IO
- **Mobile**: React Native (iOS + Android)
- **Storage**: S3-compatible storage
- **Payments**: SOLA API
- **Accounting**: QuickBooks Online API
- **Telephony**: SIP.js (Web), Native SIP (Mobile)
- **SMS**: VoIP.ms API

## Prerequisites

- Node.js 18+ (LTS)
- PostgreSQL 14+
- Redis 6+
- npm or pnpm

## Setup

1. **Clone and install dependencies:**

```bash
npm install
# or
pnpm install
```

2. **Set up environment variables:**

Create a `.env` file:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/trimpro?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT Secrets (generate secure random strings)
JWT_SECRET="your-secret-key-here"
JWT_REFRESH_SECRET="your-refresh-secret-here"

# App URL
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# S3 Storage
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_REGION="us-east-1"
AWS_S3_BUCKET="trimpro-uploads"

# Email (SendGrid/Mailgun/SES)
EMAIL_PROVIDER="sendgrid" # or "mailgun" or "ses"
SENDGRID_API_KEY="your-sendgrid-key"
MAILGUN_API_KEY="your-mailgun-key"
MAILGUN_DOMAIN="your-mailgun-domain"
AWS_SES_REGION="us-east-1"

# SOLA Payment API
SOLA_API_KEY="your-sola-api-key"
SOLA_API_SECRET="your-sola-api-secret"
SOLA_WEBHOOK_SECRET="your-webhook-secret"

# QuickBooks Online
QBO_CLIENT_ID="your-qbo-client-id"
QBO_CLIENT_SECRET="your-qbo-client-secret"
QBO_REDIRECT_URI="http://localhost:3000/api/qbo/callback"

# VoIP.ms SMS
VOIPMS_API_USERNAME="your-voipms-username"
VOIPMS_API_PASSWORD="your-voipms-password"
VOIPMS_DID="your-did-number"

# SIP/VoIP
SIP_SERVER="your-sip-server.com"
SIP_USERNAME="your-sip-username"
SIP_PASSWORD="your-sip-password"
SIP_DOMAIN="your-sip-domain"

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="your-google-maps-key"
```

3. **Set up database:**

```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database (development)
npm run db:push

# Or run migrations (production)
npm run db:migrate
```

4. **Seed database (optional):**

```bash
npm run db:seed
```

5. **Start development server:**

```bash
npm run dev
```

Visit http://localhost:3000

## Database Schema

The application uses Prisma ORM with a comprehensive schema covering:

- Multi-tenancy
- Users & Authentication (JWT + refresh tokens)
- RBAC permissions
- CRM (Clients, Contacts, Addresses)
- Leads & Pipeline
- Jobs & Job Assignments
- Estimates & Invoices
- Payments (SOLA integration)
- Purchase Orders
- Price Book
- Scheduling
- Tasks & Subtasks
- Issues/Tickets
- Communication (Calls, SMS, Email)
- QuickBooks Integration
- Automations
- Notifications
- Help/Instructions
- Audit Logs

## API Routes

### Authentication

- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/set-password` - Set new password (from temp password)
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

### Protected Routes

All protected routes require `Authorization: Bearer <access_token>` header.

## User Onboarding Flow

When an admin adds a user:

1. System generates a secure temporary password
2. User receives email with login link and temporary password
3. User logs in with temporary password
4. User is forced to "Set Password" page
5. User sets new password
6. User is automatically logged out
7. User redirected to login page
8. User logs in again with new password

## Deployment

### Server Setup

The server is already bootstrapped. See `SERVER-BOOTSTRAP-SUMMARY.md` for details.

### Deploy Application

```bash
# Build
npm run build

# Start production server
npm start
```

### Environment Variables

Ensure all production environment variables are set on your server.

### Database Migrations

```bash
# On server
npm run db:migrate
```

### PM2

The app runs with PM2. To update:

```bash
pm2 restart trim-pro
```

## Project Structure

```
trim-pro/
├── app/                  # Next.js app directory
│   ├── api/             # API routes
│   ├── (auth)/          # Auth pages
│   ├── (dashboard)/     # Dashboard pages
│   └── layout.tsx       # Root layout
├── components/          # React components
│   ├── ui/             # UI components (shadcn/ui)
│   └── features/       # Feature-specific components
├── lib/                # Utility libraries
│   ├── prisma.ts       # Prisma client
│   ├── auth.ts         # Authentication utilities
│   ├── permissions.ts  # RBAC permissions
│   └── ...
├── prisma/             # Prisma schema and migrations
│   ├── schema.prisma   # Database schema
│   └── seed.ts         # Seed data
└── public/             # Static assets
```

## Development

### Code Style

- TypeScript strict mode
- ESLint + Prettier (configured via Next.js)
- Component-based architecture
- Server Actions for mutations
- API Routes for external integrations

### Testing

```bash
# Run tests (when implemented)
npm test
```

## Security

- JWT access + refresh tokens
- bcrypt password hashing (12 rounds)
- RBAC with granular permissions
- SQL injection prevention (Prisma)
- XSS protection
- CSRF protection
- Rate limiting (to be implemented)
- Audit logging

## License

Proprietary - All Rights Reserved

## Support

For support and documentation, see the in-app Help system.
