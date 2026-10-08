-- Three-role model (src/lib/roleModel.ts): OWNER, ENCODER, SECRETARY.
-- Additive only; the other RoleName values stay so historical rows still resolve.
ALTER TYPE "RoleName" ADD VALUE 'SECRETARY';
