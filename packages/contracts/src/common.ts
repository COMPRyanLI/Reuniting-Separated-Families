export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: { path: string; message: string }[];
    requestId?: string;
  };
}
