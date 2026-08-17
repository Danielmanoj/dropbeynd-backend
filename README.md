# Drop Beyond — Backend API Server

Express REST API with Drizzle ORM, Postgres (Neon), Cloudinary file storage, Clerk auth, and Stripe payments.

## Deployment to Render

1. **Create a Web Service on Render**:
   - Go to [Render Dashboard](https://dashboard.render.com).
   - Click **New +** -> **Web Service** -> Connect `Danielmanoj/dropbeynd-backend`.

2. **Configure Settings**:
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

3. **Environment Variables**:
   Add the following environment variables in Render's Environment tab:
   - `DATABASE_URL` : Your Postgres connection string (from Neon)
   - `CLOUDINARY_CLOUD_NAME` : Your Cloudinary cloud name
   - `CLOUDINARY_API_KEY` : Your Cloudinary API key
   - `CLOUDINARY_API_SECRET` : Your Cloudinary API secret
   - `FRONTEND_URL` : Your Vercel frontend URL (e.g. `https://dropbeynd-frontend.vercel.app`)
   - `PORT` : `10000`

4. **Deploy**:
   - Click **Create Web Service**!

## Database Synchronization
To sync database tables on Neon:
```bash
npm run db:sync
```
