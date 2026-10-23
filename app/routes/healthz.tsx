import prisma from "../db.server";

// Used by the uptime monitor. Answers ok only if the database answers too.
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ ok: false }, { status: 503 });
  }
};