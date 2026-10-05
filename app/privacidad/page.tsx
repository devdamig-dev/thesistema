export const metadata = {
  title: "Política de privacidad | GastroPilot",
  description:
    "Política de privacidad de GastroPilot y tratamiento de datos vinculados a la integración con WhatsApp Business.",
};

const UPDATED_AT = "5 de octubre de 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="mb-3 text-sm font-medium text-slate-500">GastroPilot</p>
        <h1 className="text-3xl font-semibold tracking-tight">Política de privacidad</h1>
        <p className="mt-3 text-sm text-slate-500">Última actualización: {UPDATED_AT}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">1. Alcance</h2>
            <p className="mt-2">
              Esta política explica cómo GastroPilot, servicio operado por Damián Gómez,
              trata información cuando una empresa utiliza la plataforma y, en particular,
              cuando conecta una cuenta de WhatsApp Business mediante las herramientas de Meta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">2. Información que podemos tratar</h2>
            <p className="mt-2">Según las funciones utilizadas, podemos tratar:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>datos de cuenta y de acceso necesarios para autenticar usuarios;</li>
              <li>datos del negocio cargados por sus administradores y colaboradores;</li>
              <li>identificadores técnicos de WhatsApp Business, como el identificador de la cuenta y del número de teléfono;</li>
              <li>tokens de autorización necesarios para mantener la integración con Meta;</li>
              <li>mensajes, estados de entrega y datos de contacto recibidos o enviados a través del número de WhatsApp Business conectado;</li>
              <li>registros técnicos y de auditoría necesarios para seguridad, soporte y diagnóstico.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">3. Finalidades</h2>
            <p className="mt-2">Utilizamos la información únicamente para:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>prestar y mantener las funcionalidades de GastroPilot;</li>
              <li>conectar el WhatsApp Business elegido por cada negocio;</li>
              <li>recibir, mostrar, organizar y permitir responder conversaciones;</li>
              <li>ejecutar automatizaciones y funciones solicitadas por el negocio;</li>
              <li>prevenir fraude, abuso y accesos no autorizados;</li>
              <li>diagnosticar errores, brindar soporte y cumplir obligaciones legales aplicables.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">4. Integración con Meta y WhatsApp</h2>
            <p className="mt-2">
              La conexión de WhatsApp Business se realiza mediante productos oficiales de Meta,
              incluido WhatsApp Business Platform y Embedded Signup. Cada empresa autoriza el
              acceso a sus propios activos y puede gestionar esa relación desde las herramientas
              de Meta. GastroPilot no solicita las contraseñas personales de Facebook o WhatsApp.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">5. Proveedores y transferencias</h2>
            <p className="mt-2">
              Podemos utilizar proveedores de infraestructura y servicios tecnológicos necesarios
              para operar la plataforma, incluyendo Meta/WhatsApp, Vercel y Supabase. Estos
              proveedores procesan información en la medida necesaria para prestar sus servicios y
              están sujetos a sus propias condiciones y medidas de seguridad. No vendemos datos
              personales a anunciantes ni a terceros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">6. Conservación y seguridad</h2>
            <p className="mt-2">
              Conservamos la información durante el tiempo necesario para prestar el servicio,
              mantener la cuenta y cumplir obligaciones aplicables. Aplicamos controles de acceso,
              separación entre negocios y medidas técnicas razonables para proteger credenciales e
              información operativa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">7. Derechos y eliminación de datos</h2>
            <p className="mt-2">
              Los usuarios y administradores pueden solicitar acceso, corrección o eliminación de
              información relacionada con su cuenta. Las instrucciones específicas para solicitar
              la eliminación están disponibles en{" "}
              <a className="font-medium text-slate-900 underline" href="/eliminacion-de-datos">
                Eliminación de datos
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">8. Cambios a esta política</h2>
            <p className="mt-2">
              Podemos actualizar esta política cuando cambien las funcionalidades, proveedores o
              requisitos legales. La fecha de la última actualización se indicará al comienzo de
              esta página.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">9. Contacto</h2>
            <p className="mt-2">
              Para consultas de privacidad o solicitudes relacionadas con datos, escribí a{" "}
              <a className="font-medium text-slate-900 underline" href="mailto:devdamig@gmail.com">
                devdamig@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
