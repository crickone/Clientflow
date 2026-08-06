"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import { fireTrigger } from "@/lib/automations";
import { sendWhatsApp } from "@/lib/whatsapp/send";

export async function sendClientWhatsAppAction(
  clientId: number,
  text: string,
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  await requireUser();
  try {
    const { messageId } = await sendWhatsApp({
      subjectType: "client",
      subjectId: clientId,
      text,
    });
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "WhatsApp send failed.",
    };
  }
}

const clientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(5, "Phone is required"),
  // Must be YYYY-MM-DD (or empty) — the birthday automation matches on this
  // format; a stray "31/07/1990" would save fine but silently never fire.
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  medicalNotes: z.string().optional().or(z.literal("")),
  emergencyContactName: z.string().optional().or(z.literal("")),
  emergencyContactPhone: z.string().optional().or(z.literal("")),
  gdprConsent: z.coerce.boolean().optional(),
});

export type ClientFormState = {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
  clientId?: number;
};

function readForm(formData: FormData) {
  return {
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    dateOfBirth: String(formData.get("dateOfBirth") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    medicalNotes: String(formData.get("medicalNotes") ?? "").trim(),
    emergencyContactName: String(formData.get("emergencyContactName") ?? "").trim(),
    emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? "").trim(),
    gdprConsent: formData.get("gdprConsent") === "on",
  };
}

export async function createClientAction(
  _prev: ClientFormState | null,
  formData: FormData,
): Promise<ClientFormState> {
  await requireUser();
  const data = readForm(formData);
  const parsed = clientSchema.safeParse(data);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      errors[issue.path.join(".")] = issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data;
  const result = db
    .insert(clients)
    .values({
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email || null,
      phone: v.phone,
      dateOfBirth: v.dateOfBirth || null,
      address: v.address || null,
      medicalNotes: v.medicalNotes || null,
      emergencyContactName: v.emergencyContactName || null,
      emergencyContactPhone: v.emergencyContactPhone || null,
      gdprConsent: v.gdprConsent ?? false,
      gdprConsentDate: v.gdprConsent ? new Date() : null,
    })
    .returning({ id: clients.id })
    .all();

  const id = result[0].id;
  await logActivity("client.new", `New client added: ${v.firstName} ${v.lastName}`, {
    clientId: id,
  });
  await fireTrigger("new_client_created", id);
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientAction(
  id: number,
  _prev: ClientFormState | null,
  formData: FormData,
): Promise<ClientFormState> {
  await requireUser();
  const data = readForm(formData);
  const parsed = clientSchema.safeParse(data);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[issue.path.join(".")] = issue.message;
    return { ok: false, errors };
  }
  const existing = db.select().from(clients).where(eq(clients.id, id)).get();
  if (!existing) return { ok: false, message: "Client not found" };
  const v = parsed.data;
  db
    .update(clients)
    .set({
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email || null,
      phone: v.phone,
      dateOfBirth: v.dateOfBirth || null,
      address: v.address || null,
      medicalNotes: v.medicalNotes || null,
      emergencyContactName: v.emergencyContactName || null,
      emergencyContactPhone: v.emergencyContactPhone || null,
      gdprConsent: v.gdprConsent ?? false,
      gdprConsentDate:
        v.gdprConsent && !existing.gdprConsentDate
          ? new Date()
          : existing.gdprConsentDate,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))
    .run();

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

const quickClientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(5, "Phone is required"),
  email: z.string().email().optional().or(z.literal("")),
});

export async function quickAddClientAction(formData: FormData) {
  await requireUser();
  const parsed = quickClientSchema.parse({
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
  });
  const result = db
    .insert(clients)
    .values({
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      phone: parsed.phone,
      email: parsed.email || null,
    })
    .returning()
    .all();
  const created = result[0];
  await logActivity("client.new", `New client added: ${parsed.firstName} ${parsed.lastName}`, {
    clientId: created.id,
  });
  revalidatePath("/clients");
  revalidatePath("/packages/new");
  return created;
}

export async function deleteClientAction(id: number) {
  await requireUser();
  db.delete(clients).where(eq(clients.id, id)).run();
  await logActivity("client.delete", `Client #${id} deleted`);
  revalidatePath("/clients");
  redirect("/clients");
}
