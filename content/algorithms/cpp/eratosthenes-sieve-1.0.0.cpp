#include <iostream>
int main() {
  int limit;
  std::cin >> limit;
  int composite[31] = {};
  int marks[31] = {};
  composite[0] = 1;
  composite[1] = 1;
  for (int p = 2; p * p <= limit; p = p + 1) {
    if (composite[p] == 0) {
      for (int multiple = p * p; multiple <= limit; multiple = multiple + p) {
        composite[multiple] = 1;
        marks[multiple] = marks[multiple] + 1;
      }
    }
  }
  int count = 0;
  for (int i = 2; i <= limit; i = i + 1) {
    if (composite[i] == 0) {
      if (count > 0) { std::cout << " "; }
      std::cout << i;
      count = count + 1;
    }
  }
  std::cout << "\n";
  return 0;
}
