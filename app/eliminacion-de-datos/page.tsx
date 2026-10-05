export const metadata = {
  title: "Eliminación de datos | GastroPilot",
  description: "Instrucciones para solicitar la eliminación de datos en GastroPilot.",
};

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="mb-3 text-sm font-medium text-slate-500">GastroPilot</p>
        <h1 className="text-3xl font-semibold tracking-tight">Eliminación de datos</h1>

        <div className="mt-8 space-y-7 text-[15px] leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">Cómo solicitarla</h2>
            <p className="mt-2">
              Para solicitar la eliminación de datos asociados a tu cuenta o a una integración de
              WhatsApp Business, escribí desde el correo vinculado a tu cuenta a{" "}
              <a className="font-medium text-slate-900 underline" href="mailto:devdamig@gmail.com">
                devdamig@gmail.com
              </a>
              , con el asunto <strong>“Solicitud de eliminación de datos - GastroPilot”</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Qué información incluir</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>nombre del negocio;</li>
              <li>correo de la cuenta administradora;</li>
              <li>si corresponde, el número de WhatsApp Business conectado;</li>
              <li>qué datos o integración querés eliminar.</li>
            </ul>
            <p className="mt-3">
              Podemos pedir información adicional únicamente para verificar que la solicitud proviene
              de una persona autorizada para administrar ese negocio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Qué ocurre después</h2>
            <p className="mt-2">
              Una vez validada la solicitud, eliminaremos o desvincularemos los datos que correspondan,
              incluyendo credenciales de integración de WhatsApp Business cuando sean parte del pedido,
              salvo información que debamos conservar por obligaciones legales, seguridad o prevención de fraude.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Desconexión desde Meta</h2>
            <p className="mt-2">
              También podés administrar o revocar permisos concedidos a aplicaciones desde las
              configuraciones de tu cuenta y negocio en Meta. Revocar permisos puede impedir que
              GastroPilot continúe accediendo a los activos de WhatsApp Business autorizados.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Privacidad</h2>
            <p className="mt-2">
              Para conocer cómo tratamos la información, consultá nuestra{" "}
              <a className="font-medium text-slate-900 underline" href="/privacidad">
                Política de privacidad
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
