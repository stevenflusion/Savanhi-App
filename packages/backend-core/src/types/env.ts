export type BackendEnv = {
  serviceName: string;
  nodeEnv: string;
  port: number;
  allowedOrigins: string[];
  databaseUrl: string;
  authJwtSecret: string;
  authJwtIssuer: string;
  authJwtAudience: string;
  trustProxy: boolean;
  otpProvider: "development" | "resend";
  otpDevCode?: string;
  otpResend?: {
    apiKey: string;
    from: string;
    timeoutMs: number;
  };
  rateLimits: {
    api: number;
    otpRequest: number;
    otpVerify: number;
    refresh: number;
  };
};
