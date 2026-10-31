#include <iostream>
int main() {
  int n = {{n}};
  int values[30];
  int ending[30];
  for (int i = 0; i < n; i = i + 1) { std::cin >> values[i]; }
  int answer = 0;
  if (n > 0) {
    int current = values[0];
    ending[0] = current;
    answer = current;
    for (int i = 1; i < n; i = i + 1) {
      if (current < 0) { current = values[i]; }
      else { current = current + values[i]; }
      ending[i] = current;
      if (current > answer) { answer = current; }
    }
  }
  std::cout << answer << "\n";
  return 0;
}
