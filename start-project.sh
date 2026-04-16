#!/bin/bash

# GitHub Desktop - Development startup script
# Configura Node.js v22.18.0 via nvm-windows

PATH_NODE_HOME="C:\nvm\v22.18.0"
PATH_NODE_BIN="$PATH_NODE_HOME/bin"

export NODE_HOME="$PATH_NODE_HOME"
export PATH="$PATH_NODE_HOME:$PATH_NODE_BIN:$PATH"

echo "Using Node.js version: $(node -v)"
echo "Using npm version: $(npm -v)"
echo "Using yarn version: $(yarn --version)"

# Variable para el puerto (por defecto usar la variable de entorno PORT o 3000)
PORT_NUMBER=""

# Procesar los argumentos
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port=*)
      PORT_NUMBER="${1#*=}"
      shift
      ;;
    --port)
      if [[ -n "$2" && "$2" != --* ]]; then
        PORT_NUMBER="$2"
        shift 2
      else
        echo "Error: Se esperaba un valor para --port"
        exit 1
      fi
      ;;
    *)
      # Guardar el primer argumento que no sea una opcion
      if [[ -z "$COMMAND" ]]; then
        COMMAND="$1"
        shift
      else
        ARGS+=($1)
        shift
      fi
      ;;
  esac
done

# Si se proporciono un puerto, configurar la variable de entorno PORT
if [[ -n "$PORT_NUMBER" ]]; then
  export PORT="$PORT_NUMBER"
  echo "Usando puerto: $PORT_NUMBER"
fi

# Ejecuta el comando que se pase como argumento
# Si no hay argumentos, abre una shell con este entorno
if [[ -z "$COMMAND" ]]; then
    $SHELL
else
    if [[ ${#ARGS[@]} -eq 0 ]]; then
        exec "$COMMAND"
    else
        exec "$COMMAND" "${ARGS[@]}"
    fi
fi

# How use this script
# ./start-project.sh                          # Opens a shell with the right Node
# ./start-project.sh yarn start               # Start dev server
# ./start-project.sh yarn build:dev           # Build for development
# ./start-project.sh yarn build:prod          # Build for production
# ./start-project.sh yarn test                # Run tests
# ./start-project.sh yarn lint                # Run linter
