interface OccupancyCardProps {
  totalPax: number;
  totalCapacity: number;
  occupancyPercent: number;
}

function getOccupancyLevel(occupancyPercent: number) {
  if (occupancyPercent >= 85) {
    return 'danger';
  }

  if (occupancyPercent >= 60) {
    return 'warning';
  }

  return 'success';
}

export function OccupancyCard({ totalPax, totalCapacity, occupancyPercent }: OccupancyCardProps) {
  const level = getOccupancyLevel(occupancyPercent);

  return (
    <article className={`occupancy-card is-${level}`}>
      <div>
        <p className="eyebrow">Ocupacion actual</p>
        <strong>
          {totalPax} / {totalCapacity} PAX
        </strong>
      </div>
      <div className="occupancy-meter" aria-label={`Ocupacion ${occupancyPercent}%`}>
        <span style={{ width: `${occupancyPercent}%` }} />
      </div>
      <div className="occupancy-footer">
        <span>{occupancyPercent}%</span>
        <span>{occupancyPercent < 60 ? 'Operativo' : occupancyPercent < 85 ? 'Alto' : 'Limite'}</span>
      </div>
    </article>
  );
}
