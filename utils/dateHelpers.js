export const getNextDayString = (dateString) => {
  const nextDay = new Date(dateString);
  nextDay.setDate(nextDay.getDate() + 1);
  // console.log(nextDay);
  return nextDay.toISOString().split("T")[0];
}

export const isValidDateFormat = (dateString) => {
  // Check if it matches YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if(!dateRegex.test(dateString)) {
    return false;
  }

  // Check if it's a valid actual date
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().split('T')[0] === dateString;
}