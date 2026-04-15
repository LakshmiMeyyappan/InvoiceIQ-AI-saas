import axios from "axios";

const API = axios.create({
  /*baseURL: "http://127.0.0.1:8000",*/
  baseURL: "http://13.233.116.154:8501",

});

export const getInvoices = () => API.get("/invoices/");
export const uploadInvoice = (file) => {
  const formData = new FormData();
  formData.append("file", file);

  return API.post("/upload/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const askAI = (question) =>
  API.post("/ask/", { question });

export default API;