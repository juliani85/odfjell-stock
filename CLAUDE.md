# Agente Aduana

Control de Stock para **Odfjell Terminals Tagsa SA** — terminal Campana. App interna de operaciones para registrar salidas, ingresos, transferencias y stock de tanques. Proyecto independiente y aislado del resto de agentes de Julian.

## Alcance y aislamiento

- Este proyecto vive en `c:\Users\julia\.claude\Agente ADUANA\`.
- **Solo trabajar con archivos dentro de esta carpeta.** No leer, modificar ni referenciar nada del Agente personal (estudio de arquitectura, propuestas PDF, Instagram, website del estudio, Nano Banana) ni del Agente Inversiones (trading, TradingView).
- **Ignorar memorias de otros proyectos.** Las memorias sobre obras, fotos de casas, dirección de obra, propuestas de arquitectura, Instagram del estudio, etc. no aplican acá. Este agente es para gestión de stock de una terminal química.
- Las preferencias generales de Julian siguen valiendo (responder en español argentino, no pedir permiso para escribir archivos, código limpio sin comentarios innecesarios).

## Stack y estructura

- Frontend estático en `public/`: `index.html`, `css/`, `js/`, `img/`.
- HTML5 semántico + CSS3 moderno + JS vanilla. Sin backend.
- Datos persistidos en `public/datos.json` y configuración de vistas en `public/vistas.json`.
- Login local (usuario/contraseña) con roles **admin** (registro completo) y **viewer** (solo consulta de salidas).

## Dominio funcional

- Registrar salida de producto por tanque
- Ingreso a depósito
- Transferencia entre tanques
- Consulta de stock por tanque
- Historial general e historial por tanque
- Reportes diarios
- Vista reducida para usuarios viewer (solo tablón de salidas nuevas)

## Referencia externa

- `IC-36-26-F-02-Listado de niveles y alarmas para Tks T.CampanaCOMPLETO (1).pdf` en la raíz del proyecto — planilla oficial de niveles y alarmas por tanque de la terminal.
