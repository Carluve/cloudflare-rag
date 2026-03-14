import { cn } from "../lib/utils";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  IconUpload,
  IconFile,
  IconCheck,
  IconX,
  IconPhoto,
} from "@tabler/icons-react";
import { useDropzone } from "react-dropzone-esm";
import { exampleFiles } from "../lib/exampleFiles";
import { stream } from "fetch-event-stream";

interface UploadStep {
  label: string;
  status: "pending" | "active" | "completed" | "error";
  detail?: string;
}

// Maps backend `step` field to the step index in our progress list
const STEP_MAP: Record<string, number> = {
  upload: 0,
  extract_text: 1,
  extract_images: 2,
  chunking: 3,
  embedding: 4,
  done: 5,
};

export const FileUpload = ({
  onChange,
  sessionId,
  setSessionId,
  setSelectedExample,
  onImagesExtracted,
}: {
  onChange?: () => void;
  sessionId: string;
  setSessionId: (sessionId: string) => void;
  setSelectedExample: (example: (typeof exampleFiles)[0] | null) => void;
  onImagesExtracted?: (images: string[]) => void;
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [fileInfo, setFileInfo] = useState<
    Record<
      string,
      {
        chunks: number;
        status: string;
        error?: string;
        steps: UploadStep[];
        images?: string[];
      }
    >
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const removeErrorFiles = () => {
    setFiles((prev) => prev.filter((f) => fileInfo[f.name]?.status !== "error"));
    setFileInfo((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k].status === "error") delete next[k];
      }
      return next;
    });
  };

  const createSteps = (): UploadStep[] => [
    { label: "Uploading file", status: "pending" },
    { label: "Extracting text", status: "pending" },
    { label: "Extracting images", status: "pending" },
    { label: "Splitting into chunks", status: "pending" },
    { label: "Generating embeddings", status: "pending" },
    { label: "Indexing in database", status: "pending" },
  ];

  const handleFileChange = async (newFiles: File[]) => {
    removeErrorFiles();
    setFiles((prev) => [...prev, ...newFiles]);

    for (const file of newFiles) {
      // Example file shortcut
      if (file.type === "test") {
        setFileInfo((prev) => ({
          ...prev,
          [file.name]: {
            chunks: 129,
            status: "success",
            steps: createSteps().map((s) => ({
              ...s,
              status: "completed" as const,
            })),
          },
        }));
        setFiles([
          new File(new Array(777777).fill("test"), file.name, {
            type: "application/pdf",
          }),
        ]);
        toast.success(`Loaded ${file.name}`);
        return;
      }

      // Real upload
      const steps = createSteps();
      steps[0].status = "active";

      setFileInfo((prev) => ({
        ...prev,
        [file.name]: { chunks: 0, status: "uploading", steps },
      }));

      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("sessionId", sessionId);

      try {
        const response = await stream("/api/upload", {
          method: "POST",
          body: formData,
        });

        for await (const event of response) {
          let parsed: any;
          try {
            parsed = JSON.parse(
              event?.data?.trim().replace(/^data:\s*/, "") || ""
            );
          } catch {
            continue;
          }

          // --- Error ---
          if (parsed.error) {
            setFileInfo((prev) => ({
              ...prev,
              [file.name]: {
                chunks: 0,
                status: "error",
                error: parsed.error,
                steps:
                  prev[file.name]?.steps.map((s) =>
                    s.status === "active"
                      ? { ...s, status: "error" as const }
                      : s
                  ) || [],
              },
            }));
            toast.error(parsed.error);
            return;
          }

          // --- Done ---
          if (parsed.step === "done") {
            setFileInfo((prev) => ({
              ...prev,
              [file.name]: {
                chunks: parsed.totalChunks ?? prev[file.name]?.chunks ?? 0,
                status: "success",
                steps: createSteps().map((s) => ({
                  ...s,
                  status: "completed" as const,
                })),
                images: prev[file.name]?.images,
              },
            }));
            toast.success(`Successfully processed ${file.name}`);
            onChange?.();
            continue;
          }

          // --- Step progress ---
          if (parsed.step || parsed.message) {
            const stepKey = parsed.step as string | undefined;
            const stepIdx =
              stepKey && stepKey in STEP_MAP ? STEP_MAP[stepKey] : -1;

            setFileInfo((prev) => {
              const info = prev[file.name];
              if (!info) return prev;

              const newSteps = info.steps.map((s, i) => {
                if (stepIdx >= 0) {
                  if (i < stepIdx) return { ...s, status: "completed" as const, detail: undefined };
                  if (i === stepIdx)
                    return {
                      ...s,
                      status: "active" as const,
                      detail: parsed.message,
                    };
                }
                return s;
              });

              return {
                ...prev,
                [file.name]: {
                  ...info,
                  status: parsed.message || info.status,
                  steps: newSteps,
                  chunks: parsed.totalChunks ?? info.chunks,
                },
              };
            });

            // Images payload
            if (parsed.images && onImagesExtracted) {
              setFileInfo((prev) => ({
                ...prev,
                [file.name]: {
                  ...prev[file.name],
                  images: parsed.images,
                },
              }));
              onImagesExtracted(parsed.images);
            }
          }
        }
      } catch (error) {
        setFileInfo((prev) => ({
          ...prev,
          [file.name]: {
            chunks: 0,
            status: "error",
            error: "Network error — please try again",
            steps:
              prev[file.name]?.steps.map((s) =>
                s.status === "active"
                  ? { ...s, status: "error" as const }
                  : s
              ) || [],
          },
        }));
        toast.error(`Error uploading ${file.name}`);
      }
    }
  };

  const handleClick = () => {
    removeErrorFiles();
    fileInputRef.current?.click();
  };

  const { getRootProps, isDragActive } = useDropzone({
    multiple: true,
    noClick: true,
    onDrop: handleFileChange,
    onDropRejected: (err) => console.log(err),
  });

  return (
    <div className="w-full">
      {/* Drop zone */}
      <div className="w-full" {...getRootProps()}>
        <div
          onClick={handleClick}
          className={cn(
            "block rounded-xl cursor-pointer w-full relative overflow-hidden transition-all duration-300",
            "border-2 border-dashed",
            isDragActive
              ? "border-primary bg-accent/50 scale-[1.02]"
              : "border-border hover:border-primary/50 hover:bg-accent/30",
            "p-6"
          )}
        >
          <input
            ref={fileInputRef}
            id="file-upload-handle"
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md,.csv"
            multiple
            onChange={(e) =>
              handleFileChange(Array.from(e.target.files || []))
            }
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center gap-3">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                isDragActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-accent-foreground"
              )}
            >
              <IconUpload className="h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {isDragActive ? "Drop files here" : "Upload documents"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Drag &amp; drop or click to browse
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Example files */}
      {files.length === 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-muted-foreground font-medium px-1">
            Try examples:
          </p>
          {exampleFiles.map((example, index) => (
            <button
              key={index}
              className="w-full text-left text-xs text-primary hover:text-primary/80 hover:bg-accent/50 rounded-lg px-2 py-1.5 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                setSessionId(example.sessionId);
                setSelectedExample(example);
                handleFileChange([
                  new File([example.name], example.fileName, {
                    type: "TEST",
                  }),
                ]);
              }}
            >
              {example.name}
            </button>
          ))}
        </div>
      )}

      {/* Uploaded files with step-by-step progress */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2 animate-fadeIn">
          <h3 className="text-xs font-medium text-muted-foreground px-1">
            Documents
          </h3>
          <div className="space-y-2 overflow-y-auto max-h-[400px] pr-1">
            {files.map((file, idx) => {
              const info = fileInfo[file.name];
              const isSuccess = info?.status === "success";
              const isError = info?.status === "error";
              return (
                <div
                  key={"file" + idx}
                  className={cn(
                    "rounded-xl p-3 border transition-all animate-fadeIn",
                    isError
                      ? "border-destructive/30 bg-destructive/5"
                      : isSuccess
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border bg-card"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                        isSuccess
                          ? "bg-green-500/10 text-green-500"
                          : isError
                          ? "bg-destructive/10 text-destructive"
                          : "bg-accent text-accent-foreground"
                      )}
                    >
                      {isSuccess ? (
                        <IconCheck className="h-4 w-4" />
                      ) : isError ? (
                        <IconX className="h-4 w-4" />
                      ) : (
                        <IconFile className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                        {isSuccess && info.chunks > 0 &&
                          ` -- ${info.chunks} chunks`}
                      </p>

                      {/* Step progress */}
                      {info?.steps && !isSuccess && !isError && (
                        <div className="mt-2 space-y-1">
                          {info.steps.map((step, stepIdx) => (
                            <div
                              key={stepIdx}
                              className="flex items-center gap-2"
                            >
                              <div
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                  step.status === "completed" &&
                                    "bg-green-500",
                                  step.status === "active" &&
                                    "bg-primary step-pulse",
                                  step.status === "error" &&
                                    "bg-destructive",
                                  step.status === "pending" &&
                                    "bg-muted-foreground/30"
                                )}
                              />
                              <span
                                className={cn(
                                  "text-[10px] leading-tight",
                                  step.status === "active" &&
                                    "text-primary font-medium",
                                  step.status === "completed" &&
                                    "text-green-500",
                                  step.status === "error" &&
                                    "text-destructive",
                                  step.status === "pending" &&
                                    "text-muted-foreground/50"
                                )}
                              >
                                {step.label}
                                {step.status === "active" &&
                                  step.detail && (
                                    <span className="text-muted-foreground ml-1">
                                      ({step.detail})
                                    </span>
                                  )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Images extracted */}
                      {info?.images && info.images.length > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                          <IconPhoto className="h-3 w-3" />
                          <span>{info.images.length} images found</span>
                        </div>
                      )}

                      {isError && info.error && (
                        <p className="text-xs text-destructive mt-1">
                          {info.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
