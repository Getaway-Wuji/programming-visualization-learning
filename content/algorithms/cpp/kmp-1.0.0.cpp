#include <iostream>
#include <string>
int main() {
  std::string text;
  std::string pattern;
  int phase = 0;
  std::getline(std::cin, text);
  std::getline(std::cin, pattern);
  int n = text.size();
  int m = pattern.size();
  int prefix[30];
  int built = 0;
  int buildIndex = 1;
  int border = 0;
  int textIndex = 0;
  int matched = 0;
  int answer = -1;
  phase = 1;
  if (m > 0) {
    prefix[0] = 0;
    built = 1;
    while (buildIndex < m) {
      while (border > 0 && pattern[buildIndex] != pattern[border]) {
        border = prefix[border - 1];
      }
      if (pattern[buildIndex] == pattern[border]) { border = border + 1; }
      prefix[buildIndex] = border;
      built = buildIndex + 1;
      buildIndex = buildIndex + 1;
    }
  }
  phase = 2;
  if (m == 0) { answer = 0; }
  else {
    while (textIndex < n && answer < 0) {
      while (matched > 0 && text[textIndex] != pattern[matched]) {
        matched = prefix[matched - 1];
      }
      if (text[textIndex] == pattern[matched]) { matched = matched + 1; }
      if (matched == m) { answer = textIndex - m + 1; }
      textIndex = textIndex + 1;
    }
  }
  phase = 3;
  std::cout << answer << "\n";
  return 0;
}
