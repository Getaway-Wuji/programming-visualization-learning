#include <iostream>

int main() {
  int n = {{n}};
  int values[12];
  for (int i = 0; i < n; i = i + 1) {
    std::cin >> values[i];
  }
  int target;
  std::cin >> target;
  int matches = 0;
  int first = -1;
  int second = -1;
  for (int i = 0; i < n; i = i + 1) {
    for (int j = i + 1; j < n; j = j + 1) {
      if (values[i] + values[j] == target) {
        matches = matches + 1;
        first = i;
        second = j;
      }
    }
  }
  if (matches != 1) {
    std::cout << "INVALID_INPUT\n";
    return 1;
  }
  std::cout << first << " " << second << "\n";
  return 0;
}
