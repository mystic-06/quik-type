const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map(url => url.trim().replace(/\/$/, ""))
  : ["https://quik-type.vercel.app"];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin 
    if (!origin) {
      callback(null, true);
      return;
    }

    const cleanOrigin = origin.trim().replace(/\/$/, "");

    // Check direct allowed list
    if (allowedOrigins.includes(cleanOrigin)) {
      callback(null, true);
      return;
    }

    // Allow any localhost / 127.0.0.1 for local dev
    if (cleanOrigin.includes("localhost") || cleanOrigin.includes("127.0.0.1")) {
      callback(null, true);
      return;
    }

    // Allow Vercel preview / deployment URLs
    if (cleanOrigin.endsWith(".vercel.app")) {
      callback(null, true);
      return;
    }

    // Otherwise, deny in production, allow in dev
    if (process.env.NODE_ENV !== "production") {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST"],
};

module.exports = {
  allowedOrigins,
  corsOptions
};
