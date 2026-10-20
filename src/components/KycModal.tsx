import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

const KYC_BUCKET = "kyc-documents";
const VERIFY_SECONDS = 30;
const MAX_ID_BYTES = 5 * 1024 * 1024;

const input =
  "w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

type Profile = Tables<"profiles">;

type KycModalProps = {
  open: boolean;
  userId: string;
  defaultName: string;
  kycStatus: string | null;
  idCardUrl: string | null;
  onSubmitted?: (patch: Partial<Profile>) => void;
  onVerified: (profile: Profile) => void;
};

export function KycModal({
  open,
  userId,
  defaultName,
  kycStatus,
  idCardUrl,
  onSubmitted,
  onVerified,
}: KycModalProps) {
  const [fullName, setFullName] = useState(defaultName);
  const [address, setAddress] = useState("");
  const [idCard, setIdCard] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"form" | "verifying">("form");
  const [secondsLeft, setSecondsLeft] = useState(VERIFY_SECONDS);
  const finishing = useRef(false);
  const submittedThisSession = useRef(false);
  const onSubmittedRef = useRef(onSubmitted);
  onSubmittedRef.current = onSubmitted;
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  useEffect(() => {
    if (defaultName) setFullName(defaultName);
  }, [defaultName]);

  useEffect(() => {
    const normalizedStatus = (kycStatus ?? "").trim().toLowerCase();
    const hasSubmittedDoc = Boolean(idCardUrl && idCardUrl.trim() !== "");
    // New / unverified users always start on the form.
    // Only resume the countdown when the record proves a submission happened:
    // status is pending AND an ID card URL is stored (or submitted this session).
    if (
      normalizedStatus === "pending" &&
      (hasSubmittedDoc || submittedThisSession.current)
    ) {
      setPhase("verifying");
    } else if (normalizedStatus !== "pending") {
      submittedThisSession.current = false;
      setPhase("form");
    } else {
      // pending WITHOUT an id_card_url means the form was never submitted
      // (e.g. legacy row) — keep the user on the form, never the countdown.
      setPhase("form");
    }
  }, [kycStatus, idCardUrl, open]);

  useEffect(() => {
    if (!open || phase !== "verifying") return;

    finishing.current = false;
    const startedAt = Date.now();
    setSecondsLeft(VERIFY_SECONDS);

    const finish = async () => {
      if (finishing.current) return;
      finishing.current = true;

      const { data, error: verifyError } = await supabase
        .from("profiles")
        .update({ kyc_status: "verified" })
        .eq("id", userId)
        .select("*")
        .maybeSingle();

      if (verifyError) {
        finishing.current = false;
        setError(verifyError.message);
        toast.error(verifyError.message);
        setPhase("form");
        return;
      }

      toast.success("Identity verified.");
      onVerifiedRef.current(data ?? ({ kyc_status: "verified" } as Profile));
    };

    const tick = () => {
      const remaining = Math.max(
        0,
        VERIFY_SECONDS - Math.floor((Date.now() - startedAt) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0) void finish();
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [open, phase, userId]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = fullName.trim();
    const cleanAddress = address.trim();

    if (!cleanName || !cleanAddress || !idCard) {
      setError("Please enter your full name, address, and upload an ID card image.");
      return;
    }
    if (!idCard.type.startsWith("image/")) {
      setError("ID card must be an image file.");
      return;
    }
    if (idCard.size > MAX_ID_BYTES) {
      setError("ID card image must be 5MB or smaller.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const extension = idCard.name.includes(".")
        ? idCard.name.split(".").pop()?.toLowerCase()
        : "jpg";
      const path = `${userId}/${Date.now()}-id-card.${extension || "jpg"}`;

      const { error: uploadError } = await supabase.storage
        .from(KYC_BUCKET)
        .upload(path, idCard, { contentType: idCard.type, upsert: true });

      if (uploadError) {
        setError(uploadError.message);
        toast.error(uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from(KYC_BUCKET)
        .getPublicUrl(path);
      const idCardUrl = publicUrlData.publicUrl;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: cleanName,
          address: cleanAddress,
          id_card_url: idCardUrl,
          kyc_status: "pending",
        })
        .eq("id", userId);

      if (profileError) {
        setError(profileError.message);
        toast.error(profileError.message);
        return;
      }

      submittedThisSession.current = true;
      onSubmittedRef.current?.({
        full_name: cleanName,
        address: cleanAddress,
        id_card_url: idCardUrl,
        kyc_status: "pending",
      });
      setPhase("verifying");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't submit KYC. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      {phase === "verifying" ? (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-glow"
        >
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <h2 className="mt-6 font-display text-2xl font-bold">Verifying your identity...</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Please wait while we review your ID card.
          </p>
          <p className="mt-6 font-display text-5xl font-bold text-primary">{secondsLeft}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            seconds remaining
          </p>
        </div>
      ) : (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="kyc-title"
          className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-glow"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
            Required
          </p>
          <h2 id="kyc-title" className="mt-2 font-display text-2xl font-bold">
            Complete KYC
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your details and upload a photo of your ID card to unlock the dashboard.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="kyc-name" className="text-sm font-medium">
                Full Name
              </label>
              <input
                id="kyc-name"
                className={input}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="kyc-address" className="text-sm font-medium">
                Address
              </label>
              <textarea
                id="kyc-address"
                className={`${input} min-h-[88px] resize-y`}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, city, country"
                autoComplete="street-address"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="kyc-id" className="text-sm font-medium">
                ID Card Image
              </label>
              <input
                id="kyc-id"
                className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground"
                type="file"
                accept="image/*"
                onChange={(e) => setIdCard(e.target.files?.[0] ?? null)}
                required
              />
              {idCard && (
                <p className="text-xs text-muted-foreground">Selected: {idCard.name}</p>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Uploading…" : "Submit"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
