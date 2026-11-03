// Owner provisioning is a privileged, offline operation. Public requests and
// spoofed identity headers can never create or claim an organization.
export async function POST() {
  return Response.json(
    { error: 'La activación requiere tu enlace privado de invitación.' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}
