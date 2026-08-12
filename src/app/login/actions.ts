"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function loginAction(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const username = formData.get("username");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      username,
      password,
      redirectTo: "/",
    });
    return { error: null };
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Incorrect username or password." };
    }
    throw err;
  }
}
