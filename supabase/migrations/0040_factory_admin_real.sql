-- La cuenta de Mi ropa del dueño es ra1990@hotmail.com (la única no-PC del proyecto). 0038 sembraba otro email que
-- no tiene cuenta; se lo reemplaza para que el rol 'admin' quede en la cuenta real. Idempotente.
insert into factory.acceso (email, rol) values ('ra1990@hotmail.com', 'admin') on conflict (email) do nothing;
delete from factory.acceso where email = 'raa1990.rs@gmail.com' and rol = 'admin';
