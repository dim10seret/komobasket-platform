const LOCAL_ADMIN_EMAIL = "local-admin@komobasket.gr";

export type AdminIdentity = {
  email: string;
  isLocal: boolean;
};

export function getAdminIdentity(request: Request): AdminIdentity | null {
  if (process.env.NODE_ENV !== "production") {
    return {
      email: process.env.ADMIN_EMAIL || LOCAL_ADMIN_EMAIL,
      isLocal: true,
    };
  }

  const email = request.headers
    .get("cf-access-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  const accessToken = request.headers.get("cf-access-jwt-assertion");
  const allowedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  if (!email || !accessToken || !allowedEmail || email !== allowedEmail) {
    return null;
  }

  return { email, isLocal: false };
}

export function requireAdmin(request: Request) {
  const identity = getAdminIdentity(request);

  if (!identity) {
    return {
      identity: null,
      response: Response.json(
        { error: "Δεν έχετε πρόσβαση στη διαχείριση των ανακοινώσεων." },
        { status: 401 },
      ),
    } as const;
  }

  return { identity, response: null } as const;
}
