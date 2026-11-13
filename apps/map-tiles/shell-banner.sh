case $- in
  *i*) ;;
  *) return ;;
esac

printf '\nOpenBeacon map tiles\n\n'
map-tiles --help
printf '\nStart with: map-tiles status\nService logs are in the container logs.\n\n'
