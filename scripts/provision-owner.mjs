import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export class OwnerProvisioningError extends Error {}

/**
 * Privileged bootstrap. Only an operator with the database credential can run it.
 * Returns a secret invitation URL; never log the returned object.
 * Existing activated owners cannot be replaced or reset by this operation.
 */
export async function provisionOwner(pool, { email, name = 'Propietario Daybook', siteUrl }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new OwnerProvisioningError('Configura DAYBOOK_OWNER_EMAIL con un correo válido.');
  }
  if (!name || name.length > 160) throw new OwnerProvisioningError('El nombre debe tener entre 1 y 160 caracteres.');
  let base;
  try { base = new URL(siteUrl); } catch { throw new OwnerProvisioningError('Configura DAYBOOK_SITE_URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:')) || base.username || base.password) {
    throw new OwnerProvisioningError('DAYBOOK_SITE_URL debe ser HTTPS, salvo las pruebas locales.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Both first-time setup and invitation renewal serialize on the same lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('daybook-owner-bootstrap'))");
    const organization = (await client.query(`SELECT id,"ownerId" FROM organizations WHERE id='daybook' FOR UPDATE`)).rows[0];
    const now = new Date().toISOString();
    let ownerId, memberId;

    if (organization) {
      ownerId = organization.ownerId;
      const owners = (await client.query(`SELECT id,email,"userId",status FROM members WHERE "organizationId"='daybook' AND role='owner' FOR UPDATE`)).rows;
      if (owners.length !== 1) throw new OwnerProvisioningError('El espacio existente no tiene un propietario inequívoco. Revisa su configuración antes de continuar.');
      const owner = owners[0];
      if (owner.email.toLowerCase() !== email) throw new OwnerProvisioningError('El espacio ya está reservado a otro correo propietario.');
      if (owner.userId || owner.status !== 'invited') throw new OwnerProvisioningError('La cuenta propietaria ya está activada o no admite una nueva invitación.');
      memberId = owner.id;
    } else {
      ownerId = randomUUID();
      memberId = randomUUID();
      await client.query(`INSERT INTO organizations(id,"ownerId",name,"createdAt") VALUES('daybook',$1,'Servicios Daybook',$2)`, [ownerId, now]);
      await client.query(`INSERT INTO members(id,"organizationId","ownerId","userId",email,name,role,status,"invitedBy","createdAt","updatedAt") VALUES($1,'daybook',$2,NULL,$3,$4,'owner','invited',NULL,$5,$5)`, [memberId, ownerId, email, name, now]);
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await client.query(`INSERT INTO invitations("memberId","ownerId","tokenHash","expiresAt","createdAt") VALUES($1,$2,$3,$4,$5) ON CONFLICT("memberId") DO UPDATE SET "tokenHash"=excluded."tokenHash","expiresAt"=excluded."expiresAt","createdAt"=excluded."createdAt"`, [memberId, ownerId, tokenHash, expiresAt, now]);
    await client.query('COMMIT');

    const invitationUrl = new URL('/login', base.origin);
    invitationUrl.searchParams.set('invite', token);
    return { invitationUrl: invitationUrl.href, expiresAt, email, ownerId, memberId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new OwnerProvisioningError('Uso: node scripts/provision-owner.mjs --output /ruta/privada/activacion.json');
  }
  if (!process.env.DATABASE_URL) throw new OwnerProvisioningError('Falta DATABASE_URL.');
  const outputPath = resolve(args[1]);
  // Reserve a new private file first; never overwrite an existing secret or follow a symlink.
  const output = await open(outputPath, 'wx', 0o600);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  let saved = false;
  try {
    const invitation = await provisionOwner(pool, {
      email: process.env.DAYBOOK_OWNER_EMAIL,
      name: process.env.DAYBOOK_OWNER_NAME,
      siteUrl: process.env.DAYBOOK_SITE_URL,
    });
    await output.writeFile(JSON.stringify(invitation, null, 2) + '\n', 'utf8');
    await output.sync();
    saved = true;
    console.log('La invitación propietaria quedó guardada en el archivo privado indicado. No la publiques ni la incluyas en el repositorio.');
  } finally {
    await output.close();
    if (!saved) await unlink(outputPath).catch(() => {});
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof OwnerProvisioningError ? error.message : 'No se pudo preparar la invitación. Revisa la conexión, las migraciones y la ruta privada de salida.');
    process.exitCode = 1;
  });
}
