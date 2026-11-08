-- El dueño pasó su cuenta a raa1990.rs@gmail.com (borró la de hotmail). El rol admin sigue a la cuenta.
-- Idempotente.
insert into factory.acceso (email, rol) values ('raa1990.rs@gmail.com', 'admin') on conflict (email) do nothing;
delete from factory.acceso where email = 'ra1990@hotmail.com' and rol = 'admin';
